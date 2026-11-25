import { prisma } from "../../config/prisma";
import { AppError } from "../../utils/AppError";
import { env } from "../../config/env";
import { priceCart, resolveDeliveryZone, generateOrderNumber } from "./order.pricing";
import { OrderStatus, DeliveryStatus, ApprovalStatus, AuditAction, Role, PaymentStatus } from "@prisma/client";
import { logger } from "../../utils/logger";

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
  // The access token stays valid for a few minutes after an account is
  // deactivated, so re-check on this money-creating action.
  const buyer = await prisma.user.findUnique({ where: { id: userId }, select: { isActive: true } });
  if (!buyer?.isActive) throw AppError.forbidden();

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
  // The whole order is priced, accepted and delivered under the first item's
  // kitchen, so a mixed cart must never get through.
  if (cart.items.some((i) => i.foodItem.vendorId !== vendor.id)) {
    throw AppError.badRequest("Your cart has items from more than one kitchen. Please order from one kitchen at a time.");
  }

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
    // Claim the cart first. Two simultaneous checkouts (double tap, retry) can't
    // both succeed: the second finds the rows already gone and rolls back. It
    // also guarantees the order contains exactly the items that were priced.
    const cleared = await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
    if (cleared.count !== cart.items.length) {
      throw AppError.conflict("Your cart changed — please review it and try again");
    }

    // Claim the coupon use atomically so parallel checkouts can't push it past
    // maxUses (the check in priceCart alone is read-then-write).
    if (input.couponCode) {
      const c = await tx.coupon.findUnique({ where: { code: input.couponCode } });
      if (!c) throw AppError.badRequest("This coupon isn't valid for this order");
      const claimed = await tx.coupon.updateMany({
        where:
          c.maxUses != null
            ? { code: input.couponCode, usedCount: { lt: c.maxUses } }
            : { code: input.couponCode },
        data: { usedCount: { increment: 1 } },
      });
      if (claimed.count === 0) throw AppError.badRequest("This coupon has reached its usage limit");
    }

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

    await tx.auditLog.create({
      data: { action: AuditAction.ORDER_CREATED, actorType: "user", actorId: userId, orderId: created.id },
    });

    return created;
  });

  return order;
}

// Called by the payments module once a payment is confirmed successful.
// Centralised here so order-state transitions live in one place.
//
// The PENDING_PAYMENT -> PLACED move is a conditional update, so when the
// callback and the status poll land together (different serverless instances)
// exactly ONE of them wins: one commission-ledger row, one set of
// notifications. Returns true only for the call that actually placed it.
export async function placeOrderIfPending(orderId: string): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) throw AppError.notFound("Order not found");

    const moved = await tx.order.updateMany({
      where: { id: orderId, status: OrderStatus.PENDING_PAYMENT },
      data: { status: OrderStatus.PLACED, placedAt: new Date() },
    });
    if (moved.count === 0) return false; // already placed (or not payable) — no-op

    await tx.commissionLedger.create({
      data: {
        vendorId: order.vendorId,
        orderId: order.id,
        grossAmount: order.subtotal,
        // commissionAmt is the platform's markup on this order; the vendor's
        // net payout is therefore exactly the prices they listed.
        commissionRate:
          Number(order.subtotal) > 0
            ? Math.round((Number(order.commissionAmt) / Number(order.subtotal)) * 10000) / 100
            : 0,
        commissionAmt: order.commissionAmt,
        netPayoutAmt: Number(order.subtotal) - Number(order.commissionAmt),
      },
    });

    await tx.auditLog.create({
      data: { action: AuditAction.ORDER_STATUS_CHANGED, actorType: "system", orderId, metadata: { to: "PLACED" } },
    });

    return true;
  });
}

// Kept for any other caller; same atomic behaviour, returns the order.
export async function markOrderPlaced(orderId: string) {
  await placeOrderIfPending(orderId);
  return prisma.order.findUniqueOrThrow({ where: { id: orderId } });
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
      payments: {
        orderBy: { initiatedAt: "desc" },
        take: 1,
        select: { id: true, method: true, status: true, amount: true, mpesaReceiptNo: true, initiatedAt: true, confirmedAt: true },
      },
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
  // A rider may only see an order that is assigned to THEM (previously any
  // rider could open any order that had been assigned to someone).
  let isRider = false;
  if (requester.role === Role.RIDER && order.delivery?.riderId) {
    const rider = await prisma.rider.findUnique({ where: { userId: requester.id }, select: { id: true } });
    isRider = rider?.id === order.delivery.riderId;
  }
  const isAdmin = requester.role === Role.ADMIN;

  if (!isOwner && !isVendor && !isRider && !isAdmin) {
    throw AppError.forbidden("You don't have access to this order");
  }
  // Payment rows hold raw Safaricom callback payloads, checkout IDs and the
  // payer's phone — admin only, plus a trimmed copy for the paying customer.
  const { payments, ...orderWithoutPayments } = order;
  if (isAdmin) return order;
  // A vendor sees what they earn, never the customer-facing prices, the
  // platform's commission, or any payment record.
  if (isVendor) return toVendorView(orderWithoutPayments);

  // Customers and riders never see the platform's commission.
  const { commissionAmt, ...customerSafe } = orderWithoutPayments;
  void commissionAmt;
  if (isOwner) {
    return {
      ...customerSafe,
      payments: payments.map(({ rawCallbackJson, merchantRequestId, checkoutRequestId, ...p }) => {
        void rawCallbackJson;
        void merchantRequestId;
        void checkoutRequestId;
        return p;
      }),
    };
  }
  return customerSafe; // rider: no payment details
}

// Strips customer prices / commission from an order for the vendor and adds
// `vendorPayout` = exactly the prices the vendor listed x quantities.
function toVendorView<
  T extends {
    subtotal: unknown;
    discountTotal: unknown;
    deliveryFee: unknown;
    commissionAmt: unknown;
    total: unknown;
    items: Array<{ unitPrice: unknown; lineTotal: unknown }>;
  },
>(order: T) {
  const { subtotal, commissionAmt, discountTotal, deliveryFee, total, items, ...rest } = order;
  void discountTotal;
  void deliveryFee;
  void total;
  return {
    ...rest,
    items: items.map(({ unitPrice, lineTotal, ...item }) => {
      void unitPrice;
      void lineTotal;
      return item;
    }),
    vendorPayout: Number(subtotal) - Number(commissionAmt),
  };
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

  // Conditional update: only applies if the order still has the status we
  // validated against (e.g. an admin or the customer hasn't changed it since).
  // Moving to READY_FOR_PICKUP also creates the UNASSIGNED Delivery row so the
  // order shows up for riders.
  const updated = await prisma.$transaction(async (tx) => {
    const moved = await tx.order.updateMany({
      where: { id: orderId, status: order.status },
      data: {
        status: nextStatus,
        cancelReason: nextStatus === OrderStatus.REJECTED ? reason : undefined,
        cancelledAt: nextStatus === OrderStatus.REJECTED ? new Date() : undefined,
      },
    });
    if (moved.count === 0) throw AppError.conflict("This order was just updated — refresh and try again");

    if (nextStatus === OrderStatus.READY_FOR_PICKUP) {
      await tx.delivery.upsert({
        where: { orderId },
        create: { orderId, status: DeliveryStatus.UNASSIGNED },
        update: {},
      });
    }
    return tx.order.findUniqueOrThrow({ where: { id: orderId } });
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

  if (nextStatus === OrderStatus.REJECTED) {
    // A PLACED order is a PAID order. Make the pending refund impossible to miss.
    logger.error("REFUND REQUIRED: vendor rejected a paid order", { orderId, orderNumber: order.orderNumber, total: Number(order.total) });
  }

  // NOTE: a REJECTED order after successful payment needs a real refund —
  // Daraja B2C reversal requires a separate, security-credential-signed API
  // call that needs production-grade credential handling. This is flagged
  // for the admin refund queue (see admin module) rather than auto-fired,
  // so a human confirms every refund before money moves.

  try {
    const { notifyOrderStatusChange } = await import("../notifications/notification.service");
    const customer = await prisma.user.findUnique({ where: { id: order.customerId } });
    if (customer) await notifyOrderStatusChange(customer.id, customer.phone, order.orderNumber, nextStatus);
  } catch (err) {
    logger.error("Vendor status notification failed", { orderId, error: String(err) });
  }

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

  if (order.status === OrderStatus.PENDING_PAYMENT) {
    // Never cancel an order the customer may be paying for right now — the money
    // would arrive for an order that can no longer be placed.
    const paid = await prisma.payment.findFirst({ where: { orderId, status: PaymentStatus.SUCCESS } });
    if (paid) throw AppError.badRequest("Your payment was received — the order is being confirmed. Please check your orders in a moment.");
    const inFlight = await prisma.payment.findFirst({
      where: { orderId, status: PaymentStatus.PENDING, initiatedAt: { gt: new Date(Date.now() - 120_000) } },
    });
    if (inFlight) throw AppError.badRequest("A payment is in progress for this order. Wait a minute, then try again.");
  }

  // Conditional: if the kitchen accepted it a moment ago, the cancel loses.
  const result = await prisma.order.updateMany({
    where: { id: orderId, status: order.status },
    data: { status: OrderStatus.CANCELLED, cancelledAt: new Date(), cancelReason: reason },
  });
  if (result.count === 0) {
    throw AppError.conflict("This order was just updated and can no longer be cancelled");
  }
  if (order.status === OrderStatus.PLACED) {
    logger.error("REFUND REQUIRED: customer cancelled a paid order", { orderId, orderNumber: order.orderNumber, total: Number(order.total) });
  }
  return prisma.order.findUniqueOrThrow({ where: { id: orderId } });
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
  if (statusFilter && !(Object.values(OrderStatus) as string[]).includes(statusFilter)) {
    throw AppError.badRequest("Invalid status filter");
  }
  const vendor = await prisma.vendor.findUnique({ where: { userId: vendorUserId } });
  if (!vendor) throw AppError.notFound("Vendor profile not found");
  const orders = await prisma.order.findMany({
    where: { vendorId: vendor.id, ...(statusFilter ? { status: statusFilter as OrderStatus } : {}) },
    orderBy: { createdAt: "desc" },
    include: { items: true, address: true, customer: { select: { fullName: true, phone: true } } },
  });
  return orders.map(toVendorView);
}
