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

export async function approveVendor(actorId: string, vendorId: string) {
  const vendor = await prisma.vendor.update({ where: { id: vendorId }, data: { status: ApprovalStatus.APPROVED } });
  await prisma.auditLog.create({ data: { action: AuditAction.VENDOR_APPROVED, actorType: "admin", actorId, metadata: { vendorId } } });
  return vendor;
}

export async function suspendVendor(actorId: string, vendorId: string) {
  const vendor = await prisma.vendor.update({ where: { id: vendorId }, data: { status: ApprovalStatus.SUSPENDED, isOpen: false } });
  await prisma.auditLog.create({ data: { action: AuditAction.VENDOR_SUSPENDED, actorType: "admin", actorId, metadata: { vendorId } } });
  return vendor;
}

export async function setVendorCommission(vendorId: string, rate: number) {
  const vendor = await prisma.vendor.update({ where: { id: vendorId }, data: { commissionRate: rate } });
  await prisma.auditLog.create({ data: { action: AuditAction.COMMISSION_UPDATED, actorType: "admin", metadata: { vendorId, rate } } });
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
  const rider = await prisma.rider.update({ where: { id: riderId }, data: { status: ApprovalStatus.APPROVED } });
  await prisma.auditLog.create({ data: { action: AuditAction.RIDER_APPROVED, actorType: "admin", actorId, metadata: { riderId } } });
  return rider;
}

export async function suspendRider(actorId: string, riderId: string) {
  const rider = await prisma.rider.update({ where: { id: riderId }, data: { status: ApprovalStatus.SUSPENDED, isAvailable: false } });
  await prisma.auditLog.create({ data: { action: AuditAction.RIDER_SUSPENDED, actorType: "admin", actorId, metadata: { riderId } } });
  return rider;
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

// Records the decision to refund. Actually moving money back to the
// customer requires Safaricom's B2C API (a separate initiator credential
// and security-credential encryption flow, distinct from the C2B/STK flow
// used for collection) — that's flagged in the README as not wired up, so
// this deliberately only records the decision and cancels the order rather
// than pretending to move real money.
export async function issueRefund(actorId: string, orderId: string, reason: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw AppError.notFound("Order not found");

  const updated = await prisma.order.update({
    where: { id: orderId },
    data: { status: OrderStatus.CANCELLED, cancelledAt: new Date(), cancelReason: reason },
  });

  await prisma.auditLog.create({
    data: { action: AuditAction.REFUND_ISSUED, actorType: "admin", actorId, orderId, metadata: { reason, amount: Number(order.total) } },
  });

  return updated;
}

// Manual support override for order status — the normal paths are the
// vendor dashboard (accept/prepare/ready) and the rider dashboard
// (accept/pickup/deliver); this exists for when an order gets stuck or a
// vendor/rider isn't using their dashboard, so support can unblock a
// customer directly. Deliberately excludes PENDING_PAYMENT, PLACED, and
// EXPIRED — those are payment- and system-driven, not something to set by
// hand — and refuses to touch an order that hasn't actually been paid for.
const ADMIN_SETTABLE_STATUSES: OrderStatus[] = [
  OrderStatus.ACCEPTED,
  OrderStatus.PREPARING,
  OrderStatus.READY_FOR_PICKUP,
  OrderStatus.ASSIGNED,
  OrderStatus.PICKED_UP,
  OrderStatus.DELIVERED,
  OrderStatus.CANCELLED,
  OrderStatus.REJECTED,
];

const DELIVERY_STATUS_FOR_ORDER_STATUS: Partial<Record<OrderStatus, DeliveryStatus>> = {
  [OrderStatus.ASSIGNED]: DeliveryStatus.ASSIGNED,
  [OrderStatus.PICKED_UP]: DeliveryStatus.PICKED_UP,
  [OrderStatus.DELIVERED]: DeliveryStatus.DELIVERED,
};

export async function updateOrderStatus(actorId: string, orderId: string, status: OrderStatus) {
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

  const isCancelLike = status === OrderStatus.CANCELLED || status === OrderStatus.REJECTED;

  const updated = await prisma.order.update({
    where: { id: orderId },
    data: {
      status,
      ...(isCancelLike ? { cancelledAt: new Date(), cancelReason: "Updated by admin" } : {}),
    },
  });

  // Keep an existing Delivery row from contradicting the order status. This
  // never invents a rider assignment — it only updates a Delivery record
  // that's already there, so setting ASSIGNED/PICKED_UP/DELIVERED with no
  // real rider on the order simply leaves the "your rider" details blank
  // for the customer, same as today.
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
      metadata: { to: status, overriddenByAdmin: true },
    },
  });

  const { notifyOrderStatusChange } = await import("../notifications/notification.service");
  await notifyOrderStatusChange(order.customerId, order.customer.phone, order.orderNumber, status);

  // Email the customer their receipt once the order is delivered. Only when
  // this call actually moved the order to DELIVERED (not if it already was),
  // so re-saving the same status can't send a duplicate receipt.
  // Fire-and-forget, so the admin's request gets an instant response — the
  // .catch keeps a failed email from becoming an unhandled rejection.
  if (status === OrderStatus.DELIVERED && order.status !== OrderStatus.DELIVERED) {
    void Promise.resolve()
      .then(() => sendDeliveryReceiptEmail(order.id))
      .catch((err) => logger.error("Delivery receipt email failed", { orderId: order.id, error: String(err) }));
  }

  return updated;
}
