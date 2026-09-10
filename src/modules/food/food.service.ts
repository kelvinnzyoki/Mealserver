import { prisma } from "../../config/prisma";
import { AppError } from "../../utils/AppError";
import { ApprovalStatus } from "@prisma/client";

function slugify(name: string) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

async function requireOwnVendor(userId: string) {
  const vendor = await prisma.vendor.findUnique({ where: { userId } });
  if (!vendor) throw AppError.notFound("Vendor profile not found");
  return vendor;
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

  return prisma.foodItem.create({
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
}

export async function updateFoodItem(userId: string, itemId: string, data: Record<string, unknown>) {
  const vendor = await requireOwnVendor(userId);
  const item = await prisma.foodItem.findUnique({ where: { id: itemId } });
  if (!item || item.vendorId !== vendor.id) throw AppError.notFound("Food item not found");
  return prisma.foodItem.update({ where: { id: itemId }, data });
}

export async function deleteFoodItem(userId: string, itemId: string) {
  const vendor = await requireOwnVendor(userId);
  const item = await prisma.foodItem.findUnique({ where: { id: itemId } });
  if (!item || item.vendorId !== vendor.id) throw AppError.notFound("Food item not found");
  await prisma.foodItem.delete({ where: { id: itemId } });
}

export async function listOwnFoodItems(userId: string) {
  const vendor = await requireOwnVendor(userId);
  return prisma.foodItem.findMany({
    where: { vendorId: vendor.id },
    include: { category: true, variations: true },
    orderBy: { createdAt: "desc" },
  });
}

// ---- Public browsing ----

export async function searchFood(params: { q?: string; category?: string; todaysMenu?: boolean; zoneId?: string }) {
  return prisma.foodItem.findMany({
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
  return item;
}
