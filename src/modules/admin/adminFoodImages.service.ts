import { prisma } from "../../config/prisma";
import { AppError } from "../../utils/AppError";

export async function listFoodItems(params: { vendorId?: string; search?: string }) {
  return prisma.foodItem.findMany({
    where: {
      ...(params.vendorId ? { vendorId: params.vendorId } : {}),
      ...(params.search ? { name: { contains: params.search, mode: "insensitive" } } : {}),
    },
    orderBy: [{ vendorId: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      imageUrl: true,
      vendor: { select: { id: true, businessName: true } },
      category: { select: { id: true, name: true } },
    },
  });
}

export async function setFoodItemImage(foodItemId: string, imageUrl: string | null) {
  const item = await prisma.foodItem.findUnique({ where: { id: foodItemId } });
  if (!item) throw AppError.notFound("Food item not found");

  return prisma.foodItem.update({
    where: { id: foodItemId },
    data: { imageUrl },
    select: {
      id: true,
      name: true,
      imageUrl: true,
      vendor: { select: { id: true, businessName: true } },
      category: { select: { id: true, name: true } },
    },
  });
}
