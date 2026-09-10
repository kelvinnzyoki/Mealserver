import { prisma } from "../../config/prisma";
import { AppError } from "../../utils/AppError";
import { AuditAction } from "@prisma/client";

export function listZones() {
  return prisma.deliveryZone.findMany({ orderBy: { name: "asc" } });
}

export async function createZone(actorId: string, data: Record<string, unknown>) {
  const zone = await prisma.deliveryZone.create({ data: data as never });
  await prisma.auditLog.create({ data: { action: AuditAction.ZONE_UPDATED, actorType: "admin", actorId, metadata: { zoneId: zone.id, op: "create" } } });
  return zone;
}

export async function updateZone(actorId: string, id: string, data: Record<string, unknown>) {
  const zone = await prisma.deliveryZone.findUnique({ where: { id } });
  if (!zone) throw AppError.notFound("Zone not found");
  const updated = await prisma.deliveryZone.update({ where: { id }, data: data as never });
  await prisma.auditLog.create({ data: { action: AuditAction.ZONE_UPDATED, actorType: "admin", actorId, metadata: { zoneId: id, op: "update" } } });
  return updated;
}

export async function deleteZone(id: string) {
  const inUse = await prisma.order.count({ where: { deliveryZoneId: id } });
  if (inUse > 0) {
    // Never hard-delete a zone with order history — deactivate instead so
    // historical orders keep an intact foreign key and reporting stays
    // accurate.
    return prisma.deliveryZone.update({ where: { id }, data: { isActive: false } });
  }
  return prisma.deliveryZone.delete({ where: { id } });
}
