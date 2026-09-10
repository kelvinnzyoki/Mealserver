import { prisma } from "../../config/prisma";
import { hashPassword } from "../../utils/password";
import { normalizeKenyanPhone } from "../auth/auth.validation";
import { AppError } from "../../utils/AppError";
import { Role, ApprovalStatus } from "@prisma/client";

export async function applyAsRider(input: {
  fullName: string;
  phone: string;
  email?: string;
  password: string;
  vehicleType?: string;
  numberPlate?: string;
  nationalIdNo?: string;
}) {
  const phone = normalizeKenyanPhone(input.phone);
  const existing = await prisma.user.findUnique({ where: { phone } });
  if (existing) throw AppError.conflict("An account with this phone number already exists");

  const passwordHash = await hashPassword(input.password);
  return prisma.user.create({
    data: {
      fullName: input.fullName,
      phone,
      email: input.email,
      passwordHash,
      role: Role.RIDER,
      rider: {
        create: {
          status: ApprovalStatus.PENDING,
          vehicleType: input.vehicleType,
          numberPlate: input.numberPlate,
          nationalIdNo: input.nationalIdNo,
        },
      },
    },
    include: { rider: true },
  });
}

export function getRiderByUserId(userId: string) {
  return prisma.rider.findUnique({ where: { userId } });
}

export async function updateOwnProfile(userId: string, data: Record<string, unknown>) {
  const rider = await prisma.rider.findUnique({ where: { userId } });
  if (!rider) throw AppError.notFound("Rider profile not found");
  if (rider.status !== ApprovalStatus.APPROVED && data.isAvailable) {
    throw AppError.forbidden("Your rider account is not approved yet");
  }
  return prisma.rider.update({ where: { id: rider.id }, data });
}

export async function getDeliveryHistory(userId: string) {
  const rider = await prisma.rider.findUnique({ where: { userId } });
  if (!rider) throw AppError.notFound("Rider profile not found");
  return prisma.delivery.findMany({
    where: { riderId: rider.id },
    orderBy: { createdAt: "desc" },
    include: { order: { select: { orderNumber: true, total: true, address: true, vendor: { select: { businessName: true } } } } },
  });
}

export async function getEarningsSummary(userId: string) {
  const rider = await prisma.rider.findUnique({ where: { userId } });
  if (!rider) throw AppError.notFound("Rider profile not found");
  const deliveries = await prisma.delivery.findMany({
    where: { riderId: rider.id, status: "DELIVERED" },
  });
  const total = deliveries.reduce((sum, d) => sum + Number(d.riderEarnings), 0);
  return { totalEarnings: total, completedDeliveries: deliveries.length };
}
