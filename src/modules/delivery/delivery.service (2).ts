import { prisma } from "../../config/prisma";
import { AppError } from "../../utils/AppError";
import { logger } from "../../utils/logger";
import { OrderStatus, DeliveryStatus, ApprovalStatus, AuditAction, Prisma } from "@prisma/client";
import { distanceKm } from "../orders/order.pricing";

async function requireApprovedRider(userId: string) {
  const rider = await prisma.rider.findUnique({ where: { userId } });
  if (!rider) throw AppError.notFound("Rider profile not found");
  if (rider.status !== ApprovalStatus.APPROVED) throw AppError.forbidden("Your rider account is not approved yet");
  return rider;
}

// An order is open for riders when it's READY_FOR_PICKUP and nobody has
// claimed it. A Delivery row may not exist yet (e.g. the status was set by an
// admin rather than the vendor dashboard), so "no row" counts as unassigned
// just like an UNASSIGNED row does.
const OPEN_FOR_RIDERS: Prisma.OrderWhereInput = {
  status: OrderStatus.READY_FOR_PICKUP,
  OR: [{ delivery: { is: null } }, { delivery: { is: { status: DeliveryStatus.UNASSIGNED, riderId: null } } }],
};

// Heuristic building/office batching: orders that are ready for pickup,
// unassigned, and share the same delivery address building+area text get
// tagged with the same suggested batch key. This is NOT real route
// optimisation — it's a simple "these are probably the same drop-off" signal.
function batchKeyFor(address: { building: string | null; area: string | null } | null): string | null {
  if (!address) return null;
  const key = `${(address.building ?? "").trim().toLowerCase()}|${(address.area ?? "").trim().toLowerCase()}`;
  return key === "|" ? null : key;
}

export async function listAvailableOrders() {
  const orders = await prisma.order.findMany({
    where: OPEN_FOR_RIDERS,
    include: { vendor: true, address: true, items: true },
    orderBy: { placedAt: "asc" },
  });

  const batches = new Map<string, string[]>();
  for (const order of orders) {
    const key = batchKeyFor(order.address);
    if (!key) continue;
    batches.set(key, [...(batches.get(key) ?? []), order.id]);
  }

  return orders.map((order) => {
    const key = batchKeyFor(order.address);
    const batchMates = key ? (batches.get(key) ?? []).filter((id) => id !== order.id) : [];
    return { ...order, suggestedBatchOrderIds: batchMates };
  });
}

// Assigns one order to one rider. The claim is a conditional update inside a
// transaction ("only if it's still READY_FOR_PICKUP and unassigned"), so if
// two riders tap Accept at the same moment exactly one succeeds and the other
// gets a conflict — an order can never be assigned twice.
async function assignSingleOrder(riderId: string, orderId: string, groupBatchId?: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { address: true, vendor: true } });
  if (!order) throw AppError.notFound("Order not found");

  let distanceKmValue: number | undefined;
  if (order.address && order.vendor.latitude != null && order.vendor.longitude != null) {
    distanceKmValue = distanceKm(order.vendor.latitude, order.vendor.longitude, order.address.latitude, order.address.longitude);
  }
  // Simple flat-ish rider payout: the full delivery fee, floored at a
  // minimum so short/free-delivery-zone trips are still worth doing.
  const riderEarnings = Math.max(Number(order.deliveryFee), 80);
  const now = new Date();

  const delivery = await prisma.$transaction(async (tx) => {
    const claimed = await tx.order.updateMany({
      where: { id: orderId, status: OrderStatus.READY_FOR_PICKUP },
      data: { status: OrderStatus.ASSIGNED },
    });
    if (claimed.count === 0) {
      throw AppError.conflict("This order is no longer available — it may have been taken by another rider.");
    }

    const taken = await tx.delivery.updateMany({
      where: { orderId, status: DeliveryStatus.UNASSIGNED, riderId: null },
      data: { riderId, status: DeliveryStatus.ASSIGNED, distanceKm: distanceKmValue, riderEarnings, assignedAt: now, groupBatchId },
    });
    if (taken.count === 0) {
      const existing = await tx.delivery.findUnique({ where: { orderId } });
      // A row that's already been taken: throwing rolls the order claim back too.
      if (existing) throw AppError.conflict("Another rider has already taken this delivery");
      await tx.delivery.create({
        data: { orderId, riderId, status: DeliveryStatus.ASSIGNED, distanceKm: distanceKmValue, riderEarnings, assignedAt: now, groupBatchId },
      });
    }

    await tx.auditLog.create({
      data: { action: AuditAction.ORDER_STATUS_CHANGED, actorType: "rider", actorId: riderId, orderId, metadata: { to: OrderStatus.ASSIGNED, riderId } },
    });

    return tx.delivery.findUniqueOrThrow({ where: { orderId } });
  });

  // The assignment is already committed — a failed SMS/notification must not
  // turn a successful accept into an error for the rider.
  try {
    const { notifyOrderStatusChange } = await import("../notifications/notification.service");
    const customer = await prisma.user.findUnique({ where: { id: order.customerId } });
    if (customer) await notifyOrderStatusChange(customer.id, customer.phone, order.orderNumber, "ASSIGNED");
  } catch (err) {
    logger.error("Rider-assigned notification failed", { orderId, error: String(err) });
  }

  return delivery;
}

export async function acceptDelivery(userId: string, orderId: string, includeBatch = false) {
  const rider = await requireApprovedRider(userId);
  if (!rider.isAvailable) throw AppError.forbidden("Go online to accept deliveries");

  if (!includeBatch) {
    return assignSingleOrder(rider.id, orderId);
  }

  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { address: true } });
  if (!order) throw AppError.notFound("Order not found");
  const key = batchKeyFor(order.address);
  const groupBatchId = key ? `batch_${key.replace(/\s+/g, "_")}_${new Date().toISOString().slice(0, 10)}` : undefined;

  // The order the rider actually tapped must succeed (or fail loudly).
  const primary = await assignSingleOrder(rider.id, orderId, groupBatchId);
  if (!key) return [primary];

  // Batch-mates are best effort: if another rider grabbed one in the
  // meantime, skip it rather than failing the whole batch.
  const mates = await prisma.order.findMany({ where: { ...OPEN_FOR_RIDERS, id: { not: orderId } }, include: { address: true } });
  const results = [primary];
  for (const mate of mates.filter((o) => batchKeyFor(o.address) === key)) {
    try {
      results.push(await assignSingleOrder(rider.id, mate.id, groupBatchId));
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
    }
  }
  return results;
}

async function requireOwnDelivery(userId: string, orderId: string) {
  const rider = await requireApprovedRider(userId);
  const delivery = await prisma.delivery.findUnique({ where: { orderId } });
  if (!delivery || delivery.riderId !== rider.id) throw AppError.forbidden("This isn't your delivery");
  return delivery;
}

async function notifyCustomer(order: { customerId: string; orderNumber: string }, status: "PICKED_UP" | "DELIVERED") {
  try {
    const { notifyOrderStatusChange } = await import("../notifications/notification.service");
    const customer = await prisma.user.findUnique({ where: { id: order.customerId } });
    if (customer) await notifyOrderStatusChange(customer.id, customer.phone, order.orderNumber, status);
  } catch (err) {
    logger.error("Order status notification failed", { orderNumber: order.orderNumber, status, error: String(err) });
  }
}

// Pickup/delivery only move forward from the expected state. This also stops a
// rider from "reviving" an order an admin has since cancelled or refunded.
export async function markPickedUp(userId: string, orderId: string) {
  await requireOwnDelivery(userId, orderId);
  const order = await prisma.$transaction(async (tx) => {
    const moved = await tx.order.updateMany({
      where: { id: orderId, status: OrderStatus.ASSIGNED },
      data: { status: OrderStatus.PICKED_UP },
    });
    if (moved.count === 0) throw AppError.badRequest("This order isn't waiting to be picked up");
    await tx.delivery.update({ where: { orderId }, data: { status: DeliveryStatus.PICKED_UP, pickedUpAt: new Date() } });
    return tx.order.findUniqueOrThrow({ where: { id: orderId } });
  });
  await notifyCustomer(order, "PICKED_UP");
  return order;
}

export async function markDelivered(userId: string, orderId: string) {
  await requireOwnDelivery(userId, orderId);
  const order = await prisma.$transaction(async (tx) => {
    const moved = await tx.order.updateMany({
      where: { id: orderId, status: OrderStatus.PICKED_UP },
      data: { status: OrderStatus.DELIVERED },
    });
    if (moved.count === 0) throw AppError.badRequest("This order hasn't been picked up yet");
    await tx.delivery.update({ where: { orderId }, data: { status: DeliveryStatus.DELIVERED, deliveredAt: new Date() } });
    return tx.order.findUniqueOrThrow({ where: { id: orderId } });
  });
  await notifyCustomer(order, "DELIVERED");
  return order;
}

export async function markFailed(userId: string, orderId: string, reason: string) {
  const delivery = await requireOwnDelivery(userId, orderId);
  if (delivery.status === DeliveryStatus.DELIVERED || delivery.status === DeliveryStatus.FAILED) {
    throw AppError.badRequest("This delivery is already finished");
  }
  await prisma.delivery.update({
    where: { orderId },
    data: { status: DeliveryStatus.FAILED, failureReason: reason },
  });
  await prisma.auditLog.create({
    data: { action: AuditAction.ORDER_STATUS_CHANGED, actorType: "rider", actorId: userId, orderId, metadata: { deliveryFailed: reason } },
  });
  return { failed: true };
}
