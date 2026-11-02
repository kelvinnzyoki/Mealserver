import { prisma } from "../../config/prisma";
import { AppError } from "../../utils/AppError";
import { ApprovalStatus, MealPlanStatus } from "@prisma/client";

export async function createMealPlan(
  userId: string,
  input: { vendorId: string; frequency: "DAILY" | "WEEKDAYS" | "WEEKLY"; deliveryTime: string; addressId: string; startDate: string; endDate?: string }
) {
  const address = await prisma.address.findUnique({ where: { id: input.addressId } });
  if (!address || address.userId !== userId) throw AppError.notFound("Delivery address not found");

  // The kitchen must exist and be approved (a bad id would otherwise surface
  // as a database foreign-key error).
  const vendor = await prisma.vendor.findFirst({ where: { id: input.vendorId, status: ApprovalStatus.APPROVED } });
  if (!vendor) throw AppError.notFound("Kitchen not found");

  const startDate = new Date(input.startDate);
  const endDate = input.endDate ? new Date(input.endDate) : undefined;
  if (isNaN(startDate.getTime()) || (endDate && isNaN(endDate.getTime()))) {
    throw AppError.badRequest("Enter valid start and end dates.");
  }
  if (endDate && endDate < startDate) throw AppError.badRequest("The end date can't be before the start date.");

  return prisma.mealPlan.create({
    data: {
      userId,
      vendorId: input.vendorId,
      frequency: input.frequency,
      deliveryTime: input.deliveryTime,
      addressId: input.addressId,
      startDate,
      endDate,
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
