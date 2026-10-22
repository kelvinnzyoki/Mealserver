import { prisma } from "../../config/prisma";
import { AppError } from "../../utils/AppError";
import { logger } from "../../utils/logger";
import { ApprovalStatus, OrderStatus, DeliveryStatus, AuditAction, Role } from "@prisma/client";
import { sendDeliveryReceiptEmail } from "../notifications/deliveryReceipt.service";

export async function getDashboardStats() {
  const [customers, vendorsApproved, vendorsPending, ridersApproved, ridersPending, orderCounts, revenueAgg] =
    await Promise.all([
      prisma.user.count({ where: { role: Role.CUSTOMER } }),
      prisma.vendor.count({ where: { status: ApprovalStatus.APPROVED } }),
      prisma.vendor.count({ where: { status: ApprovalStatus.PENDING } }),
      prisma.rider.count({ where: { status: ApprovalStatus.APPROVED } }),
      prisma.rider.count({ where: { status: ApprovalStatus.PENDING } }),
      prisma.order.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.order.aggregate({
        _sum: { total: true, commissionAmt: true },
        where: { status: { in: [OrderStatus.DELIVERED, OrderStatus.PICKED_UP, OrderStatus.ASSIGNED, OrderStatus.READY_FOR_PICKUP, OrderStatus.PREPARING, OrderStatus.ACCEPTED, OrderStatus.PLACED] } },
      }),
    ]);

  return {
    customers,
    vendors: { approved: vendorsApproved, pending: vendorsPending },
    riders: { approved: ridersApproved, pending: ridersPending },
    ordersByStatus: Object.fromEntries(orderCounts.map((o) => [o.status, o._count._all])),
    revenue: {
      gross: Number(revenueAgg._sum.total ?? 0),
      platformCommission: Number(revenueAgg._sum.commissionAmt ?? 0),
    },
  };
}

export function listVendors(status?: ApprovalStatus) {
  return prisma.vendor.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: "desc" },
    include: { user: { select: { fullName: true, phone: true, email: true } }, deliveryZone: true },
  });
}

// ---------------------------------------------------------------------------
// Vendor / rider approval. Each transition is checked against the current
// status and applied with a conditional updateMany, so a double-click or two
// admins acting at once can't produce duplicate audit entries.
// ---------------------------------------------------------------------------

export async function approveVendor(actorId: string, vendorId: string) {
  const current = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { status: true } });
  if (!current) throw AppError.notFound("Vendor not found");
  if (current.status === ApprovalStatus.APPROVED) throw AppError.conflict("Vendor is already approved");

  const result = await prisma.vendor.updateMany({
    where: { id: vendorId, status: current.status },
    data: { status: ApprovalStatus.APPROVED },
  });
  if (result.count === 0) throw AppError.conflict("Vendor was changed by someone else — refresh and try again");

  await prisma.auditLog.create({
    data: {
      action: AuditAction.VENDOR_APPROVED,
      actorType: "admin",
      actorId,
      metadata: { vendorId, reinstated: current.status === ApprovalStatus.SUSPENDED },
    },
  });
  return prisma.vendor.findUniqueOrThrow({ where: { id: vendorId } });
}

export async function suspendVendor(actorId: string, vendorId: string) {
  const current = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { status: true } });
  if (!current) throw AppError.notFound("Vendor not found");
  if (current.status === ApprovalStatus.SUSPENDED) throw AppError.conflict("Vendor is already suspended");

  const result = await prisma.vendor.updateMany({
    where: { id: vendorId, status: current.status },
    data: { status: ApprovalStatus.SUSPENDED, isOpen: false },
  });
  if (result.count === 0) throw AppError.conflict("Vendor was changed by someone else — refresh and try again");

  await prisma.auditLog.create({ data: { action: AuditAction.VENDOR_SUSPENDED, actorType: "admin", actorId, metadata: { vendorId } } });
  return prisma.vendor.findUniqueOrThrow({ where: { id: vendorId } });
}

export async function setVendorCommission(actorId: string, vendorId: string, rate: number) {
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0) {
    throw AppError.badRequest("Commission rate must be a non-negative number");
  }
  const exists = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { id: true, commissionRate: true } });
  if (!exists) throw AppError.notFound("Vendor not found");

  const vendor = await prisma.vendor.update({ where: { id: vendorId }, data: { commissionRate: rate } });
  await prisma.auditLog.create({
    data: {
      action: AuditAction.COMMISSION_UPDATED,
      actorType: "admin",
      actorId,
      metadata: { vendorId, from: Number(exists.commissionRate), to: rate },
    },
  });
  return vendor;
}

export function listRiders(status?: ApprovalStatus) {
  return prisma.rider.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: "desc" },
    include: { user: { select: { fullName: true, phone: true, email: true } } },
  });
}

export async function approveRider(actorId: string, riderId: string) {
  const current = await prisma.rider.findUnique({ where: { id: riderId }, select: { status: true } });
  if (!current) throw AppError.notFound("Rider not found");
  if (current.status === ApprovalStatus.APPROVED) throw AppError.conflict("Rider is already approved");

  const result = await prisma.rider.updateMany({
    where: { id: riderId, status: current.status },
    data: { status: ApprovalStatus.APPROVED },
  });
  if (result.count === 0) throw AppError.conflict("Rider was changed by someone else — refresh and try again");

  await prisma.auditLog.create({
    data: {
      action: AuditAction.RIDER_APPROVED,
      actorType: "admin",
      actorId,
      metadata: { riderId, reinstated: current.status === ApprovalStatus.SUSPENDED },
    },
  });
  return prisma.rider.findUniqueOrThrow({ where: { id: riderId } });
}

export async function suspendRider(actorId: string, riderId: string) {
  const current = await prisma.rider.findUnique({ where: { id: riderId }, select: { status: true } });
  if (!current) throw AppError.notFound("Rider not found");
  if (current.status === ApprovalStatus.SUSPENDED) throw AppError.conflict("Rider is already suspended");

  const result = await prisma.rider.updateMany({
    where: { id: riderId, status: current.status },
    data: { status: ApprovalStatus.SUSPENDED, isAvailable: false },
  });
  if (result.count === 0) throw AppError.conflict("Rider was changed by someone else — refresh and try again");

  await prisma.auditLog.create({ data: { action: AuditAction.RIDER_SUSPENDED, actorType: "admin", actorId, metadata: { riderId } } });
  return prisma.rider.findUniqueOrThrow({ where: { id: riderId } });
}

export function listAllOrders(filters: { status?: OrderStatus; vendorId?: string }) {
  return prisma.order.findMany({
    where: { ...(filters.status ? { status: filters.status } : {}), ...(filters.vendorId ? { vendorId: filters.vendorId } : {}) },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      vendor: { select: { businessName: true } },
      customer: { select: { fullName: true, phone: true } },
      items: true,
      payments: { orderBy: { initiatedAt: "desc" }, take: 1 },
      // Lets the admin dashboard show "Rider assigned: <name>".
      delivery: {
        select: {
          status: true,
          riderId: true,
          rider: { select: { user: { select: { fullName: true, phone: true } } } },
        },
      },
    },
  });
}

export function listAllPayments() {
  return prisma.payment.findMany({
    orderBy: { initiatedAt: "desc" },
    take: 200,
    include: { order: { select: { orderNumber: true, customerId: true } } },
  });
}

export function getPlatformSettings() {
  return prisma.platformSettings.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  });
}

export function updatePlatformSettings(data: Record<string, unknown>) {
  // A generic Record<string, unknown> doesn't structurally match Prisma's
  // specific PlatformSettingsUpdateInput field types — this comes from an
  // admin-only settings form, not arbitrary user input, so the cast is safe.
  return prisma.platformSettings.upsert({
    where: { id: 1 },
    update: data as never,
    create: { id: 1, ...data } as never,
  });
}

// If an order is cancelled/rejected while a rider already has it, close out
// the rider's delivery so it doesn't sit in their history as still active.
async function failOpenDelivery(orderId: string, reason: string) {
  await prisma.delivery.updateMany({
    where: {
      orderId,
      status: { in: [DeliveryStatus.ASSIGNED, DeliveryStatus.EN_ROUTE_TO_VENDOR, DeliveryStatus.PICKED_UP, DeliveryStatus.EN_ROUTE_TO_CUSTOMER] },
    },
    data: { status: DeliveryStatus.FAILED, failureReason: reason },
  });
}

// ---------------------------------------------------------------------------
// Refunds
//
// Records the decision to refund and cancels the order. Actually moving money
// back requires Safaricom's B2C API (separate initiator credential and
// security-credential flow), which isn't wired up — so this deliberately does
// not pretend to move real money.
//
// Guards: an order that was never paid (PENDING_PAYMENT / EXPIRED) has nothing
// to refund, an already cancelled/rejected order has been dealt with, and a
// DELIVERED order can't be "cancelled" after the fact.
// ---------------------------------------------------------------------------
const NOT_REFUNDABLE: Partial<Record<OrderStatus, string>> = {
  [OrderStatus.PENDING_PAYMENT]: "This order hasn't been paid for — there's nothing to refund.",
  [OrderStatus.EXPIRED]: "This order expired without payment — there's nothing to refund.",
  [OrderStatus.CANCELLED]: "This order is already cancelled.",
  [OrderStatus.REJECTED]: "This order was already rejected.",
  [OrderStatus.DELIVERED]: "This order has already been delivered and can't be cancelled.",
};

export async function issueRefund(actorId: string, orderId: string, reason: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw AppError.notFound("Order not found");

  const blocked = NOT_REFUNDABLE[order.status];
  if (blocked) throw AppError.badRequest(blocked);

  // Conditional update: only one refund can win if two requests race.
  const result = await prisma.order.updateMany({
    where: { id: orderId, status: order.status },
    data: { status: OrderStatus.CANCELLED, cancelledAt: new Date(), cancelReason: reason },
  });
  if (result.count === 0) throw AppError.conflict("Order was changed by someone else — refresh and try again");

  await failOpenDelivery(orderId, "Order cancelled (refund issued)");

  await prisma.auditLog.create({
    data: { action: AuditAction.REFUND_ISSUED, actorType: "admin", actorId, orderId, metadata: { reason, amount: Number(order.total) } },
  });

  return prisma.order.findUniqueOrThrow({ where: { id: orderId } });
}

// ---------------------------------------------------------------------------
// Manual order status override
//
// ASSIGNED is intentionally NOT settable here: an order only becomes ASSIGNED
// when a real, approved rider accepts it from the rider dashboard. Setting
// READY_FOR_PICKUP is what makes an order show up in riders' "Available" list.
// ---------------------------------------------------------------------------
const ADMIN_SETTABLE_STATUSES: OrderStatus[] = [
  OrderStatus.ACCEPTED,
  OrderStatus.PREPARING,
  OrderStatus.READY_FOR_PICKUP,
  OrderStatus.PICKED_UP,
  OrderStatus.DELIVERED,
  OrderStatus.CANCELLED,
  OrderStatus.REJECTED,
];

const FINISHED_STATUSES: OrderStatus[] = [
  OrderStatus.DELIVERED,
  OrderStatus.CANCELLED,
  OrderStatus.REJECTED,
  OrderStatus.EXPIRED,
];

// Moving an order back to one of these would put an already-assigned order
// back in the riders' pool.
const PRE_ASSIGNMENT_STATUSES: OrderStatus[] = [
  OrderStatus.ACCEPTED,
  OrderStatus.PREPARING,
  OrderStatus.READY_FOR_PICKUP,
];

const DELIVERY_STATUS_FOR_ORDER_STATUS: Partial<Record<OrderStatus, DeliveryStatus>> = {
  [OrderStatus.PICKED_UP]: DeliveryStatus.PICKED_UP,
  [OrderStatus.DELIVERED]: DeliveryStatus.DELIVERED,
};

export async function updateOrderStatus(actorId: string, orderId: string, status: OrderStatus) {
  if (status === OrderStatus.ASSIGNED) {
    throw AppError.badRequest("Orders are assigned when a rider accepts them — it can't be set manually.");
  }
  if (!ADMIN_SETTABLE_STATUSES.includes(status)) {
    throw AppError.badRequest("That status can't be set manually.");
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { delivery: true, customer: true },
  });
  if (!order) throw AppError.notFound("Order not found");
  if (order.status === OrderStatus.PENDING_PAYMENT) {
    throw AppError.badRequest("This order hasn't been paid for yet — there's nothing to update.");
  }
  if (order.status === status) {
    throw AppError.badRequest("The order already has that status.");
  }
  if (FINISHED_STATUSES.includes(order.status)) {
    throw AppError.badRequest("This order is already finished and can't be changed.");
  }

  const hasRider = Boolean(order.delivery?.riderId);

  if (hasRider && PRE_ASSIGNMENT_STATUSES.includes(status)) {
    throw AppError.badRequest("A rider is already assigned to this order, so it can't go back to a pre-pickup status.");
  }
  if (!hasRider && (status === OrderStatus.PICKED_UP || status === OrderStatus.DELIVERED)) {
    throw AppError.badRequest("No rider is assigned to this order yet. A rider must accept it first.");
  }

  const isCancelLike = status === OrderStatus.CANCELLED || status === OrderStatus.REJECTED;

  // Optimistic concurrency: only apply if the order still has the status we
  // read. Two simultaneous requests can't both "win" (and so can't both
  // trigger notifications or a receipt email).
  const result = await prisma.order.updateMany({
    where: { id: orderId, status: order.status },
    data: {
      status,
      ...(isCancelLike ? { cancelledAt: new Date(), cancelReason: "Updated by admin" } : {}),
    },
  });
  if (result.count === 0) {
    throw AppError.conflict("This order was changed by someone else — refresh and try again.");
  }

  // READY_FOR_PICKUP is what lists the order for riders. Make sure an
  // UNASSIGNED Delivery row exists (the vendor dashboard path creates one;
  // this covers the admin path). Never assigns a rider.
  if (status === OrderStatus.READY_FOR_PICKUP) {
    await prisma.delivery.upsert({
      where: { orderId },
      create: { orderId, status: DeliveryStatus.UNASSIGNED },
      update: {},
    });
  }
  if (isCancelLike) {
    await failOpenDelivery(orderId, "Order cancelled by admin");
  }

  // Keep an existing Delivery row consistent with the order status. Never
  // invents a rider assignment.
  const deliveryStatus = DELIVERY_STATUS_FOR_ORDER_STATUS[status];
  if (order.delivery && deliveryStatus) {
    await prisma.delivery.update({
      where: { orderId },
      data: {
        status: deliveryStatus,
        ...(status === OrderStatus.PICKED_UP ? { pickedUpAt: new Date() } : {}),
        ...(status === OrderStatus.DELIVERED ? { deliveredAt: new Date() } : {}),
      },
    });
  }

  await prisma.auditLog.create({
    data: {
      action: AuditAction.ORDER_STATUS_CHANGED,
      actorType: "admin",
      actorId,
      orderId,
      metadata: { from: order.status, to: status, overriddenByAdmin: true },
    },
  });

  const { notifyOrderStatusChange } = await import("../notifications/notification.service");
  await notifyOrderStatusChange(order.customerId, order.customer.phone, order.orderNumber, status);

  // Receipt email: because of the conditional update above, we only get here
  // once per transition into DELIVERED, so no duplicate receipts.
  if (status === OrderStatus.DELIVERED) {
    void Promise.resolve()
      .then(() => sendDeliveryReceiptEmail(order.id))
      .catch((err) => logger.error("Delivery receipt email failed", { orderId: order.id, error: String(err) }));
  }

  return prisma.order.findUniqueOrThrow({ where: { id: orderId } });
}
