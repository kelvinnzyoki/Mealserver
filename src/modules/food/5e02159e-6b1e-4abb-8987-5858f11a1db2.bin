import { prisma } from "../../config/prisma";
import { AppError } from "../../utils/AppError";
import { ApprovalStatus } from "@prisma/client";
import { finalCustomerPrice } from "../../utils/pricing";

function slugify(name: string) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

async function requireOwnVendor(userId: string) {
  const vendor = await prisma.vendor.findUnique({ where: { userId } });
  if (!vendor) throw AppError.notFound("Vendor profile not found");
  return vendor;
}

// The admin's customer-price override is an admin-only concept: it must never
// be returned to the kitchen that owns the item, or to customers.
function withoutOverride<T extends { customerPriceOverride?: unknown }>(item: T) {
  const { customerPriceOverride, ...rest } = item;
  void customerPriceOverride;
  return rest;
}

// ---- Vendor-side menu management ----

export async function createCategory(userId: string, name: string, sortOrder?: number) {
  const vendor = await requireOwnVendor(userId);
  return prisma.foodCategory.create({
    data: { vendorId: vendor.id, name, slug: slugify(name), sortOrder: sortOrder ?? 0 },
  });
}

export async function updateCategory(userId: string, categoryId: string, data: { name?: string; sortOrder?: number }) {
  const vendor = await requireOwnVendor(userId);
  const category = await prisma.foodCategory.findUnique({ where: { id: categoryId } });
  if (!category || category.vendorId !== vendor.id) throw AppError.notFound("Category not found");
  return prisma.foodCategory.update({
    where: { id: categoryId },
    data: { ...data, ...(data.name ? { slug: slugify(data.name) } : {}) },
  });
}

export async function deleteCategory(userId: string, categoryId: string) {
  const vendor = await requireOwnVendor(userId);
  const category = await prisma.foodCategory.findUnique({ where: { id: categoryId } });
  if (!category || category.vendorId !== vendor.id) throw AppError.notFound("Category not found");
  await prisma.foodCategory.delete({ where: { id: categoryId } });
}

export function listOwnCategories(vendorId: string) {
  return prisma.foodCategory.findMany({ where: { vendorId }, orderBy: { sortOrder: "asc" } });
}

interface VariationInput {
  name: string;
  priceDelta: number;
  isRequired: boolean;
  groupName: string;
}

export async function createFoodItem(
  userId: string,
  data: {
    categoryId: string;
    name: string;
    description?: string;
    imageUrl?: string;
    basePrice: number;
    isTodaysMenu?: boolean;
    prepTimeMins?: number;
    calorieInfo?: string;
    variations?: VariationInput[];
  }
) {
  const vendor = await requireOwnVendor(userId);
  const category = await prisma.foodCategory.findUnique({ where: { id: data.categoryId } });
  if (!category || category.vendorId !== vendor.id) throw AppError.badRequest("Invalid category");

  const created = await prisma.foodItem.create({
    data: {
      vendorId: vendor.id,
      categoryId: data.categoryId,
      name: data.name,
      description: data.description,
      imageUrl: data.imageUrl,
      basePrice: data.basePrice,
      isTodaysMenu: data.isTodaysMenu ?? false,
      prepTimeMins: data.prepTimeMins ?? 20,
      calorieInfo: data.calorieInfo,
      variations: data.variations
        ? { create: data.variations.map((v) => ({ ...v })) }
        : undefined,
    },
    include: { variations: true },
  });
  return withoutOverride(created);
}

// Vendors may only edit these fields. Everything else (customerPriceOverride,
// vendorId, ratings, ...) is off limits, so the request body can't be used to
// change them.
const VENDOR_EDITABLE_ITEM_FIELDS = [
  "name",
  "description",
  "imageUrl",
  "basePrice",
  "isAvailable",
  "isTodaysMenu",
  "prepTimeMins",
  "calorieInfo",
  "categoryId",
] as const;

export async function updateFoodItem(userId: string, itemId: string, data: Record<string, unknown>) {
  const vendor = await requireOwnVendor(userId);
  const item = await prisma.foodItem.findUnique({ where: { id: itemId } });
  if (!item || item.vendorId !== vendor.id) throw AppError.notFound("Food item not found");

  const safe: Record<string, unknown> = {};
  for (const key of VENDOR_EDITABLE_ITEM_FIELDS) {
    if (data[key] !== undefined) safe[key] = data[key];
  }

  if (safe.basePrice !== undefined) {
    const price = Number(safe.basePrice);
    if (!Number.isFinite(price) || price <= 0) throw AppError.badRequest("Enter a price greater than 0.");
    safe.basePrice = price;
  }

  if (safe.categoryId !== undefined) {
    const category = await prisma.foodCategory.findUnique({ where: { id: String(safe.categoryId) } });
    if (!category || category.vendorId !== vendor.id) throw AppError.badRequest("Invalid category");
  }

  const updated = await prisma.foodItem.update({ where: { id: itemId }, data: safe as never });
  return withoutOverride(updated);
}

export async function deleteFoodItem(userId: string, itemId: string) {
  const vendor = await requireOwnVendor(userId);
  const item = await prisma.foodItem.findUnique({ where: { id: itemId } });
  if (!item || item.vendorId !== vendor.id) throw AppError.notFound("Food item not found");
  await prisma.foodItem.delete({ where: { id: itemId } });
}

export async function listOwnFoodItems(userId: string) {
  const vendor = await requireOwnVendor(userId);
  const items = await prisma.foodItem.findMany({
    where: { vendorId: vendor.id },
    include: { category: true, variations: true },
    orderBy: { createdAt: "desc" },
  });
  return items.map(withoutOverride);
}

// ---- Public browsing ----

// Items are stored with the VENDOR's price. Anything shown to customers gets
// the final customer price: the admin override if set, otherwise the platform
// markup (see utils/pricing.ts). The raw override field is not exposed.
function withCustomerPrice<T extends { basePrice: unknown; customerPriceOverride?: unknown }>(item: T) {
  return { ...withoutOverride(item), basePrice: finalCustomerPrice(item) };
}

export async function searchFood(params: { q?: string; category?: string; todaysMenu?: boolean; zoneId?: string }) {
  const items = await prisma.foodItem.findMany({
    where: {
      isAvailable: true,
      vendor: {
        status: ApprovalStatus.APPROVED,
        isOpen: true,
        ...(params.zoneId ? { deliveryZoneId: params.zoneId } : {}),
      },
      ...(params.todaysMenu ? { isTodaysMenu: true } : {}),
      ...(params.category ? { category: { slug: params.category } } : {}),
      ...(params.q
        ? {
            OR: [
              { name: { contains: params.q, mode: "insensitive" } },
              { description: { contains: params.q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    include: {
      vendor: { select: { id: true, businessName: true, logoUrl: true, avgPrepTimeMins: true } },
      category: true,
      variations: true,
    },
    take: 60,
    orderBy: { createdAt: "desc" },
  });
  return items.map(withCustomerPrice);
}

export async function getFoodItemDetail(id: string) {
  const item = await prisma.foodItem.findFirst({
    where: { id, isAvailable: true },
    include: {
      vendor: { select: { id: true, businessName: true, logoUrl: true, isOpen: true, status: true } },
      category: true,
      variations: true,
      reviews: { take: 10, orderBy: { createdAt: "desc" }, include: { customer: { select: { fullName: true } } } },
    },
  });
  if (!item) throw AppError.notFound("Food item not found");
  return withCustomerPrice(item);
}
