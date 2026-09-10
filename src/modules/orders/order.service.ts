import { prisma } from "../../config/prisma";
import { AppError } from "../../utils/AppError";
import { env } from "../../config/env";
import { priceCart, resolveDeliveryZone, generateOrderNumber } from "./order.pricing";
import { OrderStatus, ApprovalStatus, AuditAction, Role } from "@prisma/client";

// ----------------------------------------------------------------------------
// Checkout: turns the customer's single-vendor cart into a PENDING_PAYMENT
// order. No money moves here — a separate M-Pesa STK push (payments module)
// is what actually collects payment; this just locks in a price snapshot,
// which is why we copy name/price onto OrderItem rather than only pointing
// at FoodItem (so a later menu price change never rewrites a placed order).
// ----------------------------------------------------------------------------
export async function checkout(
  userId: string,
  input: {
    addressId: string;
    specialInstructions?: string;
    couponCode?: string;
    recipientName?: string;
    recipientPhone?: string;
    scheduledFor?: string;
  }
) {
  const cart = await prisma.cart.findUnique({
    where: { userId },
    include: {
      items: {
        include: {
          foodItem: { include: { vendor: true } },
          variations: { include: { foodVariation: true } },
        },
      },
    },
  });
  if (!cart || cart.items.length === 0) throw AppError.badRequest("Your cart is empty");

  const vendor = cart.items[0].foodItem.vendor;
  if (vendor.status !== ApprovalStatus.APPROVED) throw AppError.badRequest("This kitchen is not currently accepting orders");
  if (!vendor.isOpen) throw AppError.badRequest(`${vendor.businessName} is currently closed`);

  for (const item of cart.items) {
    if (!item.foodItem.isAvailable) throw AppError.badRequest(`${item.foodItem.name} is no longer available`);
  }

  const address = await prisma.address.findUnique({ where: { id: input.addressId } });
  if (!address || address.userId !== userId) throw AppError.notFound("Delivery address not found");

  const zone = await resolveDeliveryZone(address.latitude, address.longitude);

  const pricing = await priceCart(
    cart.items.map((ci) => ({
      foodItem: ci.foodItem,
      quantity: ci.quantity,
      notes: ci.notes,
      variations: ci.variations,
    })),
    vendor,
    zone,
    input.couponCode
  );

  const paymentTimeoutMinutes = env.paymentTimeoutMinutes;

  const order = await prisma.$transaction(async (tx) => {
    const created = await tx.order.create({
      data: {
        orderNumber: generateOrderNumber(),
        customerId: userId,
        vendorId: vendor.id,
        addressId: address.id,
        deliveryZoneId: zone?.id,
        status: OrderStatus.PENDING_PAYMENT,
        subtotal: pricing.subtotal,
        discountTotal: pricing.discountTotal,
        deliveryFee: pricing.deliveryFee,
        commissionAmt: pricing.commissionAmt,
        total: pricing.total,
        specialInstructions: input.specialInstructions,
        recipientName: input.recipientName,
        recipientPhone: input.recipientPhone,
        scheduledFor: input.scheduledFor ? new Date(input.scheduledFor) : null,
        paymentExpiresAt: new Date(Date.now() + paymentTimeoutMinutes * 60 * 1000),
        items: {
          create: pricing.items.map((i) => ({
            foodItemId: i.foodItemId,
            nameSnapshot: i.name,
            unitPrice: i.unitPrice,
            quantity: i.quantity,
            lineTotal: i.lineTotal,
            notes: i.notes,
            variations: {
              create: i.variations.map((v) => ({
                foodVariationId: v.foodVariationId,
                nameSnapshot: v.name,
                priceDeltaSnapshot: v.priceDelta,
              })),
            },
          })),
        },
      },
      include: { items: true },
    });

    if (input.couponCode) {
      await tx.coupon.updateMany({ where: { code: input.couponCode }, data: { usedCount: { increment: 1 } } });
    }

    await tx.auditLog.create({
      data: { action: AuditAction.ORDER_CREATED, actorType: "user", actorId: userId, orderId: created.id },
    });

    // Clear the cart now — a fresh STK push can always be re-initiated
    // against this same PENDING_PAYMENT order until it expires.
    await tx.cartItem.deleteMany({ where: { cartId: cart.id } });

    return created;
  });

  return order;
}

// Called by the payments module once a payment is confirmed successful.
// Centralised here so order-state transitions live in one place.
export async function markOrderPlaced(orderId: string) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId }, include: { vendor: true } });
    if (!order) throw AppError.notFound("Order not found");
    if (order.status !== OrderStatus.PENDING_PAYMENT) return order; // idempotent no-op

    const updated = await tx.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.PLACED, placedAt: new Date() },
    });

    await tx.commissionLedger.create({
      data: {
        vendorId: order.vendorId,
        orderId: order.id,
        grossAmount: order.subtotal,
        commissionRate: order.vendor.commissionRate,
        commissionAmt: order.commissionAmt,
        netPayoutAmt: Number(order.subtotal) - Number(order.commissionAmt),
      },
    });

    await tx.auditLog.create({
      data: { action: AuditAction.ORDER_STATUS_CHANGED, actorType: "system", orderId, metadata: { to: "PLACED" } },
    });

    return updated;
  });
}

export async function markOrderPaymentFailed(orderId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order || order.status !== OrderStatus.PENDING_PAYMENT) return;
  // Leave the order in PENDING_PAYMENT so the customer can retry the STK
  // push from the same order — it only becomes EXPIRED once the payment
  // window (paymentExpiresAt) actually elapses (see jobs/expireStaleOrders).
}

export async function getMyOrders(userId: string) {
  return prisma.order.findMany({
    where: { customerId: userId },
    orderBy: { createdAt: "desc" },
    include: {
      vendor: { select: { businessName: true, logoUrl: true } },
      items: true,
      delivery: true,
      payments: { orderBy: { initiatedAt: "desc" }, take: 1 },
    },
  });
}

export async function getOrderDetail(orderId: string, requester: { id: string; role: Role }) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: { include: { variations: true } },
      vendor: true,
      address: true,
      delivery: { include: { rider: { include: { user: { select: { fullName: true, phone: true } } } } } },
      payments: { orderBy: { initiatedAt: "desc" } },
      customer: { select: { fullName: true, phone: true } },
    },
  });
  if (!order) throw AppError.notFound("Order not found");

  const isOwner = order.customerId === requester.id;
  const isVendor = requester.role === Role.VENDOR && order.vendor.userId === requester.id;
  const isRider = requester.role === Role.RIDER && order.delivery?.riderId != null;
  const isAdmin = requester.role === Role.ADMIN;

  if (!isOwner && !isVendor && !isRider && !isAdmin) {
    throw AppError.forbidden("You don't have access to this order");
  }
  return order;
}

const VENDOR_TRANSITIONS: Record<string, OrderStatus[]> = {
  PLACED: [OrderStatus.ACCEPTED, OrderStatus.REJECTED],
  ACCEPTED: [OrderStatus.PREPARING],
  PREPARING: [OrderStatus.READY_FOR_PICKUP],
};

export async function vendorUpdateStatus(
  vendorUserId: string,
  orderId: string,
  nextStatus: OrderStatus,
  reason?: string
) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { vendor: true } });
  if (!order) throw AppError.notFound("Order not found");
  if (order.vendor.userId !== vendorUserId) throw AppError.forbidden("Not your order");

  const allowed = VENDOR_TRANSITIONS[order.status];
  if (!allowed || !allowed.includes(nextStatus)) {
    throw AppError.badRequest(`Cannot move order from ${order.status} to ${nextStatus}`);
  }

  const updated = await prisma.order.update({
    where: { id: orderId },
    data: {
      status: nextStatus,
      cancelReason: nextStatus === OrderStatus.REJECTED ? reason : undefined,
      cancelledAt: nextStatus === OrderStatus.REJECTED ? new Date() : undefined,
    },
  });

  await prisma.auditLog.create({
    data: {
      action: AuditAction.ORDER_STATUS_CHANGED,
      actorType: "vendor",
      actorId: vendorUserId,
      orderId,
      metadata: { to: nextStatus, reason },
    },
  });

  // NOTE: a REJECTED order after successful payment needs a real refund —
  // Daraja B2C reversal requires a separate, security-credential-signed API
  // call that needs production-grade credential handling. This is flagged
  // for the admin refund queue (see admin module) rather than auto-fired,
  // so a human confirms every refund before money moves.

  const { notifyOrderStatusChange } = await import("../notifications/notification.service");
  const customer = await prisma.user.findUnique({ where: { id: order.customerId } });
  if (customer) await notifyOrderStatusChange(customer.id, customer.phone, order.orderNumber, nextStatus);

  return updated;
}

export async function cancelOrder(userId: string, orderId: string, reason?: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw AppError.notFound("Order not found");
  if (order.customerId !== userId) throw AppError.forbidden();
  // Cast widens the array's element type to the full OrderStatus enum —
  // without it, TS infers a 2-member literal union from the array and
  // rejects comparing it against order.status's broader OrderStatus type.
  const cancellableStatuses: OrderStatus[] = [OrderStatus.PENDING_PAYMENT, OrderStatus.PLACED];
  if (!cancellableStatuses.includes(order.status)) {
    throw AppError.badRequest("This order can no longer be cancelled — it's already being prepared");
  }

  return prisma.order.update({
    where: { id: orderId },
    data: { status: OrderStatus.CANCELLED, cancelledAt: new Date(), cancelReason: reason },
  });
}

export async function reorder(userId: string, orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: { include: { variations: true, foodItem: true } } },
  });
  if (!order || order.customerId !== userId) throw AppError.notFound("Order not found");

  const cart = await prisma.cart.upsert({ where: { userId }, update: {}, create: { userId } });

  const existingCount = await prisma.cartItem.count({ where: { cartId: cart.id } });
  const existingOtherVendor = existingCount > 0
    ? await prisma.cartItem.findFirst({ where: { cartId: cart.id }, include: { foodItem: true } })
    : null;
  if (existingOtherVendor && existingOtherVendor.foodItem.vendorId !== order.vendorId) {
    throw AppError.conflict("Your cart has items from a different kitchen. Clear it first to reorder this.", {
      code: "DIFFERENT_VENDOR",
    });
  }

  for (const item of order.items) {
    const stillAvailable = await prisma.foodItem.findFirst({ where: { id: item.foodItemId, isAvailable: true } });
    if (!stillAvailable) continue; // silently skip items no longer on the menu
    await prisma.cartItem.create({
      data: {
        cartId: cart.id,
        foodItemId: item.foodItemId,
        quantity: item.quantity,
        notes: item.notes,
        variations: { create: item.variations.map((v) => ({ foodVariationId: v.foodVariationId })) },
      },
    });
  }

  return prisma.cart.findUnique({ where: { id: cart.id }, include: { items: true } });
}

export async function getVendorOrders(vendorUserId: string, statusFilter?: string) {
  const vendor = await prisma.vendor.findUnique({ where: { userId: vendorUserId } });
  if (!vendor) throw AppError.notFound("Vendor profile not found");
  return prisma.order.findMany({
    where: { vendorId: vendor.id, ...(statusFilter ? { status: statusFilter as OrderStatus } : {}) },
    orderBy: { createdAt: "desc" },
    include: { items: true, address: true, customer: { select: { fullName: true, phone: true } } },
  });
}
