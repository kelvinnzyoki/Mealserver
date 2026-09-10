import { prisma } from "../../config/prisma";
import { AppError } from "../../utils/AppError";

export function listAddresses(userId: string) {
  return prisma.address.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
}

// Explicit shape instead of deriving one from Prisma's own create() signature:
// Prisma's data param is a union of a "checked" input (nested `user` relation
// write) and an "unchecked" input (plain `userId` scalar), and Omit<union, K>
// does not distribute over unions the way you'd expect — it silently
// produces a hybrid type that matches neither branch, which is what was
// blowing up here. A plain interface plus a cast at the call site (same
// pattern used elsewhere in this file) sidesteps that entirely.
export interface CreateAddressInput {
  label: string;
  building?: string;
  street?: string;
  area?: string;
  city?: string;
  landmark?: string;
  latitude: number;
  longitude: number;
  contactPhone?: string;
  contactName?: string;
  isDefault?: boolean;
}

export async function createAddress(userId: string, data: CreateAddressInput) {
  if (data.isDefault) {
    await prisma.address.updateMany({ where: { userId }, data: { isDefault: false } });
  }
  return prisma.address.create({ data: { ...data, userId } as never });
}

export async function updateAddress(userId: string, addressId: string, data: Record<string, unknown>) {
  const existing = await prisma.address.findUnique({ where: { id: addressId } });
  if (!existing || existing.userId !== userId) throw AppError.notFound("Address not found");

  if (data.isDefault) {
    await prisma.address.updateMany({ where: { userId }, data: { isDefault: false } });
  }
  return prisma.address.update({ where: { id: addressId }, data: data as never });
}

export async function deleteAddress(userId: string, addressId: string) {
  const existing = await prisma.address.findUnique({ where: { id: addressId } });
  if (!existing || existing.userId !== userId) throw AppError.notFound("Address not found");
  await prisma.address.delete({ where: { id: addressId } });
}

export function updateProfile(userId: string, data: { fullName?: string; email?: string }) {
  return prisma.user.update({ where: { id: userId }, data });
}
