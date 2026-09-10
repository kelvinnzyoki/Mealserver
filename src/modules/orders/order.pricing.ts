import { prisma } from "../../config/prisma";
import { AppError } from "../../utils/AppError";
import { DeliveryZone, Vendor } from "@prisma/client";

// Haversine distance in km — used both to pick a delivery zone and to
// estimate rider distance for the Delivery record.
export function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

// Resolves which delivery zone an order falls under, based on the
// customer's delivery address coordinates. Zones are simple radius circles
// (centerLat/centerLng/radiusKm) rather than polygons — good enough for a
// city-level MVP; swap for a polygon/geofence table later if zones need
// irregular shapes.
export async function resolveDeliveryZone(lat: number, lng: number): Promise<DeliveryZone | null> {
  const zones = await prisma.deliveryZone.findMany({ where: { isActive: true } });
  const candidates = zones
    .filter((z) => z.centerLat != null && z.centerLng != null && z.radiusKm != null)
    .map((z) => ({ zone: z, distance: distanceKm(lat, lng, z.centerLat!, z.centerLng!) }))
    .filter((c) => c.distance <= c.zone.radiusKm!)
    .sort((a, b) => a.distance - b.distance);

  return candidates[0]?.zone ?? null;
}

export interface PricedCartItem {
  foodItemId: string;
  name: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  notes: string | null;
  variations: { foodVariationId: string; name: string; priceDelta: number }[];
}

export interface PriceBreakdown {
  subtotal: number;
  discountTotal: number;
  deliveryFee: number;
  commissionAmt: number;
  total: number;
  items: PricedCartItem[];
}

export async function priceCart(
  cartItems: Array<{
    foodItem: { id: string; name: string; basePrice: unknown };
    quantity: number;
    notes: string | null;
    variations: { foodVariation: { id: string; name: string; priceDelta: unknown } }[];
  }>,
  vendor: Vendor,
  zone: DeliveryZone | null,
  couponCode?: string
): Promise<PriceBreakdown> {
  if (cartItems.length === 0) throw AppError.badRequest("Your cart is empty");

  const items: PricedCartItem[] = cartItems.map((ci) => {
    const variationsTotal = ci.variations.reduce((sum, v) => sum + Number(v.foodVariation.priceDelta), 0);
    const unitPrice = Number(ci.foodItem.basePrice) + variationsTotal;
    return {
      foodItemId: ci.foodItem.id,
      name: ci.foodItem.name,
      unitPrice,
      quantity: ci.quantity,
      lineTotal: unitPrice * ci.quantity,
      notes: ci.notes,
      variations: ci.variations.map((v) => ({
        foodVariationId: v.foodVariation.id,
        name: v.foodVariation.name,
        priceDelta: Number(v.foodVariation.priceDelta),
      })),
    };
  });

  const subtotal = items.reduce((sum, i) => sum + i.lineTotal, 0);

  const settings = await prisma.platformSettings.findUnique({ where: { id: 1 } });
  const minOrderValue = Number(zone?.minOrderValue ?? settings?.defaultMinOrderValue ?? 0);
  if (subtotal < minOrderValue) {
    throw AppError.badRequest(`Minimum order value for delivery here is KES ${minOrderValue}`);
  }

  let discountTotal = 0;
  if (couponCode) {
    const coupon = await prisma.coupon.findUnique({ where: { code: couponCode } });
    const now = new Date();
    if (
      !coupon ||
      !coupon.isActive ||
      (coupon.vendorId && coupon.vendorId !== vendor.id) ||
      (coupon.startsAt && coupon.startsAt > now) ||
      (coupon.expiresAt && coupon.expiresAt < now) ||
      (coupon.maxUses != null && coupon.usedCount >= coupon.maxUses) ||
      subtotal < Number(coupon.minOrderValue)
    ) {
      throw AppError.badRequest("This coupon isn't valid for this order");
    }
    discountTotal =
      coupon.discountType === "PERCENTAGE"
        ? (subtotal * Number(coupon.discountValue)) / 100
        : Number(coupon.discountValue);
    discountTotal = Math.min(discountTotal, subtotal);
  }

  const isFree = zone?.isFreeDelivery ?? false;
  const deliveryFee = isFree ? 0 : Number(zone?.deliveryFee ?? settings?.defaultDeliveryFee ?? 0);

  const commissionRate = Number(vendor.commissionRate ?? settings?.defaultCommissionRate ?? 15);
  const commissionAmt = (subtotal * commissionRate) / 100;

  const total = subtotal - discountTotal + deliveryFee;

  return { subtotal, discountTotal, deliveryFee, commissionAmt, total, items };
}

export function generateOrderNumber(): string {
  const date = new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `KG-${y}${m}${d}-${rand}`;
}
