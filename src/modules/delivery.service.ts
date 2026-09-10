import { prisma } from "../../config/prisma";
import { AppError } from "../../utils/AppError";
import { OrderStatus, DeliveryStatus, ApprovalStatus, AuditAction } from "@prisma/client";
import { distanceKm } from "../orders/order.pricing";

async function requireApprovedRider(userId: string) {
  const rider = await prisma.rider.findUnique({ where: { userId } });
  if (!rider) throw AppError.notFound("Rider profile not found");
  if (rider.status !== ApprovalStatus.APPROVED) throw AppError.forbidden("Your rider account is not approved yet");
  return rider;
}

// Heuristic building/office batching: orders that are ready for pickup,
// unassigned, and share the same delivery address building+area text get
// tagged with the same suggested batch key. This is NOT real route
// optimisation (no travelling-salesman solving, no vendor-location
// clustering) — it's a simple "these are probably the same drop-off" signal
// so a rider doing a lunch run can grab several orders for one building in
// a single trip. A real optimiser would additionally cluster by vendor
// pickup location and solve for shortest route.
function batchKeyFor(address: { building: string | null; area: string | null } | null): string | null {
  if (!address) return null;
  const key = `${(address.building ?? "").trim().toLowerCase()}|${(address.area ?? "").trim().toLowerCase()}`;
  return key === "|" ? null : key;
}

export async function listAvailableOrders() {
  const orders = await prisma.order.findMany({
    where: { status: OrderStatus.READY_FOR_PICKUP, delivery: { status: DeliveryStatus.UNASSIGNED } },
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

async function assignSingleOrder(riderId: string, orderId: string, groupBatchId?: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { address: true, vendor: true } });
  if (!order) throw AppError.notFound("Order not found");
  if (order.status !== OrderStatus.READY_FOR_PICKUP) {
    throw AppError.badRequest("This order isn't ready for pickup yet");
  }

  const existingDelivery = await prisma.delivery.findUnique({ where: { orderId } });
  if (existingDelivery && existingDelivery.status !== DeliveryStatus.UNASSIGNED) {
    throw AppError.conflict("Another rider has already taken this delivery");
  }

  let distanceKmValue: number | undefined;
  if (order.address && order.vendor.latitude != null && order.vendor.longitude != null) {
    distanceKmValue = distanceKm(order.vendor.latitude, order.vendor.longitude, order.address.latitude, order.address.longitude);
  }
  // Simple flat-ish rider payout: the full delivery fee, floored at a
  // minimum so short/free-delivery-zone trips are still worth doing.
  const riderEarnings = Math.max(Number(order.deliveryFee), 80);

  const delivery = await prisma.delivery.upsert({
    where: { orderId },
    create: {
      orderId,
      riderId,
      status: DeliveryStatus.ASSIGNED,
      distanceKm: distanceKmValue,
      riderEarnings,
      assignedAt: new Date(),
      groupBatchId,
    },
    update: {
      riderId,
      status: DeliveryStatus.ASSIGNED,
      distanceKm: distanceKmValue,
      riderEarnings,
      assignedAt: new Date(),
      groupBatchId,
    },
  });

  await prisma.order.update({ where: { id: orderId }, data: { status: OrderStatus.ASSIGNED } });

  const { notifyOrderStatusChange } = await import("../notifications/notification.service");
  const customer = await prisma.user.findUnique({ where: { id: order.customerId } });
  if (customer) await notifyOrderStatusChange(customer.id, customer.phone, order.orderNumber, "ASSIGNED");

  return delivery;
}

export async function acceptDelivery(userId: string, orderId: string, includeBatch = false) {
  const rider = await requireApprovedRider(userId);

  if (!includeBatch) {
    return assignSingleOrder(rider.id, orderId);
  }

  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { address: true } });
  if (!order) throw AppError.notFound("Order not found");
  const key = batchKeyFor(order.address);
  const groupBatchId = key ? `batch_${key.replace(/\s+/g, "_")}_${new Date().toISOString().slice(0, 10)}` : undefined;

  if (!key) return assignSingleOrder(rider.id, orderId, groupBatchId);

  const mates = await prisma.order.findMany({
    where: { status: OrderStatus.READY_FOR_PICKUP, delivery: { status: DeliveryStatus.UNASSIGNED } },
    include: { address: true },
  });
  const batchOrderIds = mates.filter((o) => batchKeyFor(o.address) === key).map((o) => o.id);

  const results = [];
  for (const id of batchOrderIds) {
    results.push(await assignSingleOrder(rider.id, id, groupBatchId));
  }
  return results;
}

async function requireOwnDelivery(userId: string, orderId: string) {
  const rider = await requireApprovedRider(userId);
  const delivery = await prisma.delivery.findUnique({ where: { orderId } });
  if (!delivery || delivery.riderId !== rider.id) throw AppError.forbidden("This isn't your delivery");
  return delivery;
}

export async function markPickedUp(userId: string, orderId: string) {
  await requireOwnDelivery(userId, orderId);
  await prisma.delivery.update({
    where: { orderId },
    data: { status: DeliveryStatus.PICKED_UP, pickedUpAt: new Date() },
  });
  const order = await prisma.order.update({ where: { id: orderId }, data: { status: OrderStatus.PICKED_UP } });

  const { notifyOrderStatusChange } = await import("../notifications/notification.service");
  const customer = await prisma.user.findUnique({ where: { id: order.customerId } });
  if (customer) await notifyOrderStatusChange(customer.id, customer.phone, order.orderNumber, "PICKED_UP");

  return order;
}

export async function markDelivered(userId: string, orderId: string) {
  await requireOwnDelivery(userId, orderId);
  await prisma.delivery.update({
    where: { orderId },
    data: { status: DeliveryStatus.DELIVERED, deliveredAt: new Date() },
  });
  const order = await prisma.order.update({ where: { id: orderId }, data: { status: OrderStatus.DELIVERED } });

  const { notifyOrderStatusChange } = await import("../notifications/notification.service");
  const customer = await prisma.user.findUnique({ where: { id: order.customerId } });
  if (customer) await notifyOrderStatusChange(customer.id, customer.phone, order.orderNumber, "DELIVERED");

  return order;
}

export async function markFailed(userId: string, orderId: string, reason: string) {
  await requireOwnDelivery(userId, orderId);
  await prisma.delivery.update({
    where: { orderId },
    data: { status: DeliveryStatus.FAILED, failureReason: reason },
  });
  await prisma.auditLog.create({
    data: { action: AuditAction.ORDER_STATUS_CHANGED, actorType: "rider", actorId: userId, orderId, metadata: { deliveryFailed: reason } },
  });
  return { failed: true };
}
