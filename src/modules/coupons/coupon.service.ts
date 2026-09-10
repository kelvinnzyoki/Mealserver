import { prisma } from "../../config/prisma";
import { AppError } from "../../utils/AppError";
import { Role } from "@prisma/client";

export async function createCoupon(
  actor: { id: string; role: Role },
  data: {
    code: string;
    discountType: "PERCENTAGE" | "FIXED_AMOUNT";
    discountValue: number;
    minOrderValue: number;
    maxUses?: number;
    startsAt?: string;
    expiresAt?: string;
    vendorOnly?: boolean;
  }
) {
  let vendorId: string | undefined;
  if (actor.role === Role.VENDOR) {
    const vendor = await prisma.vendor.findUnique({ where: { userId: actor.id } });
    if (!vendor) throw AppError.notFound("Vendor profile not found");
    vendorId = vendor.id;
  }

  return prisma.coupon.create({
    data: {
      code: data.code,
      vendorId,
      discountType: data.discountType,
      discountValue: data.discountValue,
      minOrderValue: data.minOrderValue,
      maxUses: data.maxUses,
      startsAt: data.startsAt ? new Date(data.startsAt) : undefined,
      expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
    },
  });
}

export function listMyCoupons(actor: { id: string; role: Role }) {
  if (actor.role === Role.ADMIN) {
    return prisma.coupon.findMany({ orderBy: { createdAt: "desc" } });
  }
  return prisma.vendor.findUnique({ where: { userId: actor.id } }).then((vendor) => {
    if (!vendor) throw AppError.notFound("Vendor profile not found");
    return prisma.coupon.findMany({ where: { vendorId: vendor.id }, orderBy: { createdAt: "desc" } });
  });
}

export async function setCouponActive(id: string, isActive: boolean) {
  const coupon = await prisma.coupon.findUnique({ where: { id } });
  if (!coupon) throw AppError.notFound("Coupon not found");
  return prisma.coupon.update({ where: { id }, data: { isActive } });
}

// Lightweight check used by the frontend to preview a discount before
// checkout actually applies it (the real, authoritative check happens
// again inside order.pricing.priceCart at checkout time).
export async function previewCoupon(code: string, vendorId: string, subtotal: number) {
  const coupon = await prisma.coupon.findUnique({ where: { code } });
  const now = new Date();
  if (
    !coupon ||
    !coupon.isActive ||
    (coupon.vendorId && coupon.vendorId !== vendorId) ||
    (coupon.startsAt && coupon.startsAt > now) ||
    (coupon.expiresAt && coupon.expiresAt < now) ||
    (coupon.maxUses != null && coupon.usedCount >= coupon.maxUses) ||
    subtotal < Number(coupon.minOrderValue)
  ) {
    throw AppError.badRequest("This coupon isn't valid for this order");
  }
  const discount =
    coupon.discountType === "PERCENTAGE" ? (subtotal * Number(coupon.discountValue)) / 100 : Number(coupon.discountValue);
  return { valid: true, discount: Math.min(discount, subtotal) };
}
