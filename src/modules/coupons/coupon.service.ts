import { prisma } from "../../config/prisma";
import { AppError } from "../../utils/AppError";
import { Prisma, Role } from "@prisma/client";

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

  const code = data.code?.trim();
  if (!code || code.length > 40) throw AppError.badRequest("Enter a coupon code (up to 40 characters).");

  if (data.discountType !== "PERCENTAGE" && data.discountType !== "FIXED_AMOUNT") {
    throw AppError.badRequest("Pick a valid discount type.");
  }
  const discountValue = Number(data.discountValue);
  if (!Number.isFinite(discountValue) || discountValue <= 0) {
    throw AppError.badRequest("The discount must be greater than 0.");
  }
  if (data.discountType === "PERCENTAGE" && discountValue > 100) {
    throw AppError.badRequest("A percentage discount can't be more than 100.");
  }
  const minOrderValue = Number(data.minOrderValue ?? 0);
  if (!Number.isFinite(minOrderValue) || minOrderValue < 0) {
    throw AppError.badRequest("The minimum order value can't be negative.");
  }
  if (data.maxUses != null && (!Number.isInteger(data.maxUses) || data.maxUses < 1)) {
    throw AppError.badRequest("Max uses must be a whole number of 1 or more.");
  }

  const startsAt = data.startsAt ? new Date(data.startsAt) : undefined;
  const expiresAt = data.expiresAt ? new Date(data.expiresAt) : undefined;
  if ((startsAt && isNaN(startsAt.getTime())) || (expiresAt && isNaN(expiresAt.getTime()))) {
    throw AppError.badRequest("Enter valid start and expiry dates.");
  }
  if (startsAt && expiresAt && expiresAt <= startsAt) {
    throw AppError.badRequest("The expiry date must be after the start date.");
  }

  try {
    return await prisma.coupon.create({
      data: {
        code,
        vendorId,
        discountType: data.discountType,
        discountValue,
        minOrderValue,
        maxUses: data.maxUses,
        startsAt,
        expiresAt,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw AppError.conflict("A coupon with this code already exists");
    }
    throw err;
  }
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

// Pass the signed-in user as `actor` from the controller. A vendor may only
// switch their OWN coupons on or off; admins can switch any. (Without the
// actor check, any vendor who knew a coupon id could disable another kitchen's
// coupon or an admin's platform-wide one.)
export async function setCouponActive(id: string, isActive: boolean, actor?: { id: string; role: Role }) {
  const coupon = await prisma.coupon.findUnique({ where: { id } });
  if (!coupon) throw AppError.notFound("Coupon not found");

  if (actor && actor.role !== Role.ADMIN) {
    const vendor = await prisma.vendor.findUnique({ where: { userId: actor.id } });
    if (!vendor || coupon.vendorId !== vendor.id) throw AppError.notFound("Coupon not found");
  }

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
