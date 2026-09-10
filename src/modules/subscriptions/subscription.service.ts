import { prisma } from "../../config/prisma";
import { AppError } from "../../utils/AppError";
import { MealPlanStatus } from "@prisma/client";

export async function createMealPlan(
  userId: string,
  input: { vendorId: string; frequency: "DAILY" | "WEEKDAYS" | "WEEKLY"; deliveryTime: string; addressId: string; startDate: string; endDate?: string }
) {
  const address = await prisma.address.findUnique({ where: { id: input.addressId } });
  if (!address || address.userId !== userId) throw AppError.notFound("Delivery address not found");

  return prisma.mealPlan.create({
    data: {
      userId,
      vendorId: input.vendorId,
      frequency: input.frequency,
      deliveryTime: input.deliveryTime,
      addressId: input.addressId,
      startDate: new Date(input.startDate),
      endDate: input.endDate ? new Date(input.endDate) : undefined,
    },
  });
}

export function listMyMealPlans(userId: string) {
  return prisma.mealPlan.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: { vendor: { select: { businessName: true } } },
  });
}

export async function setMealPlanStatus(userId: string, id: string, status: MealPlanStatus) {
  const plan = await prisma.mealPlan.findUnique({ where: { id } });
  if (!plan || plan.userId !== userId) throw AppError.notFound("Meal plan not found");
  return prisma.mealPlan.update({ where: { id }, data: { status } });
}
