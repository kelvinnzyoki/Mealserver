import { prisma } from "../../config/prisma";
import { AppError } from "../../utils/AppError";
import { ApprovalStatus, Role } from "@prisma/client";
import { customerPrice, finalCustomerPrice } from "../../utils/pricing";

// ---------------------------------------------------------------------------
// Admin menu & pricing
//
//  1. The admin can add their own dishes without any listed kitchen. They are
//     attached to a single built-in "Mpishi254 Kitchen" vendor row that belongs
//     to the admin's own user, so the rest of the system (search, cart,
//     checkout, orders) needs no special cases.
//  2. The admin can set the FINAL customer price of ANY item (house or a
//     kitchen's) through `customerPriceOverride`. Without an override the
//     automatic tier markup from utils/pricing.ts applies. The kitchen's own
//     payout is never affected: it is always the vendor's listed price.
// ---------------------------------------------------------------------------

export const HOUSE_KITCHEN_NAME = "Mpishi254 Kitchen";

// Same slugs the home page category chips link to (?category=<slug>).
export const MENU_CATEGORIES = [
  { slug: "kenyan-delicacies", label: "Kenyan Delicacies" },
  { slug: "breakfast", label: "Breakfast" },
  { slug: "lunch", label: "Lunch" },
  { slug: "dinner", label: "Dinner" },
  { slug: "drinks", label: "Drinks" },
  { slug: "snacks", label: "Snacks" },
] as const;

const round2 = (n: number) => Math.round(n * 100) / 100;

async function getHouseVendor(adminId: string) {
  const existing = await prisma.vendor.findUnique({ where: { userId: adminId } });
  if (existing) return existing;
  return prisma.vendor.create({
    data: {
      userId: adminId,
      businessName: HOUSE_KITCHEN_NAME,
      description: "Prepared and delivered by Mpishi254",
      status: ApprovalStatus.APPROVED,
      isOpen: true,
    },
  });
}

const itemInclude = {
  vendor: { select: { id: true, businessName: true, user: { select: { role: true } } } },
  category: { select: { id: true, name: true } },
} as const;

type ItemWithRelations = NonNullable<Awaited<ReturnType<typeof findItem>>>;

function findItem(id: string) {
  return prisma.foodItem.findUnique({ where: { id }, include: itemInclude });
}

function toAdminItem(i: ItemWithRelations) {
  const vendorPrice = Number(i.basePrice);
  const override = i.customerPriceOverride == null ? null : Number(i.customerPriceOverride);
  return {
    id: i.id,
    name: i.name,
    imageUrl: i.imageUrl,
    isAvailable: i.isAvailable,
    isTodaysMenu: i.isTodaysMenu,
    vendor: { id: i.vendor.id, businessName: i.vendor.businessName },
    category: i.category,
    isHouse: i.vendor.user.role === Role.ADMIN,
    vendorPrice,
    autoPrice: customerPrice(vendorPrice),
    customerPriceOverride: override,
    finalPrice: finalCustomerPrice(i),
  };
}

export async function listMenuItems(search?: string) {
  const items = await prisma.foodItem.findMany({
    where: search?.trim() ? { name: { contains: search.trim(), mode: "insensitive" } } : undefined,
    include: itemInclude,
    orderBy: { createdAt: "desc" },
    take: 300,
  });
  return items.map(toAdminItem);
}

// price = a number sets a custom final customer price; null goes back to the
// automatic tier markup. A custom price may not be below what the kitchen is
// paid, otherwise the platform would lose money on every sale.
export async function setCustomerPrice(itemId: string, price: number | null) {
  const item = await findItem(itemId);
  if (!item) throw AppError.notFound("Food item not found");

  if (price === null) {
    await prisma.foodItem.update({ where: { id: itemId }, data: { customerPriceOverride: null } });
  } else {
    if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) {
      throw AppError.badRequest("Enter a customer price greater than 0.");
    }
    const next = round2(price);
    const floor = Number(item.basePrice);
    if (next < floor) {
      throw AppError.badRequest(`The customer price can't be lower than the kitchen's price (KES ${floor}).`);
    }
    await prisma.foodItem.update({ where: { id: itemId }, data: { customerPriceOverride: next } });
  }
  return toAdminItem((await findItem(itemId))!);
}

export async function createHouseItem(
  adminId: string,
  input: {
    name: string;
    categorySlug: string;
    customerPrice: number; // the FINAL price the customer pays
    cost?: number; // optional: what it costs you; 0 if you don't track it
    description?: string;
    prepTimeMins?: number;
    isTodaysMenu?: boolean;
    imageUrl?: string;
  }
) {
  const name = input.name?.trim();
  if (!name || name.length > 120) throw AppError.badRequest("Enter an item name (up to 120 characters).");

  const category = MENU_CATEGORIES.find((c) => c.slug === input.categorySlug);
  if (!category) throw AppError.badRequest("Pick a valid category.");

  const price = Number(input.customerPrice);
  if (!Number.isFinite(price) || price <= 0) throw AppError.badRequest("Enter a customer price greater than 0.");
  const cost = input.cost == null ? 0 : Number(input.cost);
  if (!Number.isFinite(cost) || cost < 0) throw AppError.badRequest("Cost can't be negative.");
  if (cost > price) throw AppError.badRequest("Cost can't be higher than the customer price.");

  const vendor = await getHouseVendor(adminId);

  let cat = await prisma.foodCategory.findFirst({ where: { vendorId: vendor.id, slug: category.slug } });
  if (!cat) {
    cat = await prisma.foodCategory.create({
      data: { vendorId: vendor.id, name: category.label, slug: category.slug, sortOrder: 0 },
    });
  }

  const created = await prisma.foodItem.create({
    data: {
      vendorId: vendor.id,
      categoryId: cat.id,
      name,
      description: input.description?.trim() || undefined,
      imageUrl: input.imageUrl || undefined,
      basePrice: round2(cost),
      customerPriceOverride: round2(price),
      isTodaysMenu: input.isTodaysMenu ?? false,
      prepTimeMins: input.prepTimeMins && input.prepTimeMins > 0 ? Math.round(input.prepTimeMins) : 20,
    },
  });
  return toAdminItem((await findItem(created.id))!);
}

export async function updateMenuItemFlags(itemId: string, data: { isAvailable?: boolean; isTodaysMenu?: boolean }) {
  const item = await findItem(itemId);
  if (!item) throw AppError.notFound("Food item not found");
  await prisma.foodItem.update({
    where: { id: itemId },
    data: {
      ...(typeof data.isAvailable === "boolean" ? { isAvailable: data.isAvailable } : {}),
      ...(typeof data.isTodaysMenu === "boolean" ? { isTodaysMenu: data.isTodaysMenu } : {}),
    },
  });
  return toAdminItem((await findItem(itemId))!);
}

// Only the admin's own dishes can be deleted here; kitchens manage theirs.
export async function deleteHouseItem(itemId: string) {
  const item = await findItem(itemId);
  if (!item) throw AppError.notFound("Food item not found");
  if (item.vendor.user.role !== Role.ADMIN) {
    throw AppError.badRequest("Only your own items can be deleted here. Mark a kitchen's item unavailable instead.");
  }
  try {
    await prisma.foodItem.delete({ where: { id: itemId } });
  } catch {
    // Past orders reference the item, so the database refuses the delete.
    throw AppError.badRequest("This item appears in past orders, so it can't be deleted. Mark it unavailable instead.");
  }
}

export async function getHouseKitchen(adminId: string) {
  const v = await getHouseVendor(adminId);
  return { id: v.id, businessName: v.businessName, isOpen: v.isOpen };
}

export async function setHouseKitchenOpen(adminId: string, isOpen: boolean) {
  const v = await getHouseVendor(adminId);
  const updated = await prisma.vendor.update({ where: { id: v.id }, data: { isOpen: Boolean(isOpen) } });
  return { id: updated.id, businessName: updated.businessName, isOpen: updated.isOpen };
}
