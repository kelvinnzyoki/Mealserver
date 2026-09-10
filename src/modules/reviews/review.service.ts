import { prisma } from "../../config/prisma";
import { AppError } from "../../utils/AppError";
import { OrderStatus } from "@prisma/client";

export async function createReview(
  userId: string,
  input: { orderId: string; rating: number; comment?: string; foodItemId?: string }
) {
  const order = await prisma.order.findUnique({ where: { id: input.orderId } });
  if (!order || order.customerId !== userId) throw AppError.notFound("Order not found");
  if (order.status !== OrderStatus.DELIVERED) {
    throw AppError.badRequest("You can only review an order after it's been delivered");
  }

  const existing = await prisma.review.findUnique({ where: { orderId: input.orderId } });
  if (existing) throw AppError.conflict("You've already reviewed this order");

  const review = await prisma.review.create({
    data: {
      orderId: order.id,
      customerId: userId,
      vendorId: order.vendorId,
      foodItemId: input.foodItemId,
      rating: input.rating,
      comment: input.comment,
    },
  });

  return review;
}

export function listVendorReviews(vendorId: string) {
  return prisma.review.findMany({
    where: { vendorId },
    orderBy: { createdAt: "desc" },
    include: { customer: { select: { fullName: true } } },
    take: 50,
  });
}
