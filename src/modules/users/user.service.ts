import { prisma } from "../../config/prisma";
import { AppError } from "../../utils/AppError";

export function listAddresses(userId: string) {
  return prisma.address.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
}

export async function createAddress(userId: string, data: Omit<Parameters<typeof prisma.address.create>[0]["data"], "userId">) {
  if (data.isDefault) {
    await prisma.address.updateMany({ where: { userId }, data: { isDefault: false } });
  }
  return prisma.address.create({ data: { ...data, userId } });
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
