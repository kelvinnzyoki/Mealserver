import { prisma } from "../../config/prisma";
import { hashPassword } from "../../utils/password";
import { normalizeKenyanPhone } from "../auth/auth.validation";
import { AppError } from "../../utils/AppError";
import { Role, ApprovalStatus, Prisma } from "@prisma/client";

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
  const email = input.email?.trim().toLowerCase() || undefined;

  const existing = await prisma.user.findUnique({ where: { phone } });
  if (existing) throw AppError.conflict("An account with this phone number already exists");

  if (email) {
    const emailTaken = await prisma.user.findUnique({ where: { email } });
    if (emailTaken) throw AppError.conflict("An account with this email already exists");
  }

  const passwordHash = await hashPassword(input.password);
  try {
    return await prisma.user.create({
      data: {
        fullName: input.fullName,
        phone,
        email,
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
  } catch (err) {
    // Backstop for a race between the checks above and the insert.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw AppError.conflict("An account with these details already exists");
    }
    throw err;
  }
}

export function getRiderByUserId(userId: string) {
  return prisma.rider.findUnique({ where: { userId } });
}

// Only these fields may be changed by the rider themselves. Anything else in
// the request body (status, earnings, userId, ...) is ignored, no matter what
// the validation schema lets through.
export async function updateOwnProfile(userId: string, data: Record<string, unknown>) {
  const rider = await prisma.rider.findUnique({ where: { userId } });
  if (!rider) throw AppError.notFound("Rider profile not found");

  const safe: { isAvailable?: boolean; vehicleType?: string; numberPlate?: string } = {};
  if (typeof data.isAvailable === "boolean") safe.isAvailable = data.isAvailable;
  if (typeof data.vehicleType === "string") safe.vehicleType = data.vehicleType;
  if (typeof data.numberPlate === "string") safe.numberPlate = data.numberPlate;

  if (Object.keys(safe).length === 0) throw AppError.badRequest("No valid fields to update");

  if (rider.status !== ApprovalStatus.APPROVED && safe.isAvailable) {
    throw AppError.forbidden("Your rider account is not approved yet");
  }
  return prisma.rider.update({ where: { id: rider.id }, data: safe });
}

export async function getDeliveryHistory(userId: string) {
  const rider = await prisma.rider.findUnique({ where: { userId } });
  if (!rider) throw AppError.notFound("Rider profile not found");
  return prisma.delivery.findMany({
    where: { riderId: rider.id },
    orderBy: { createdAt: "desc" },
    include: {
      order: {
        select: {
          orderNumber: true,
          total: true,
          address: true,
          vendor: { select: { businessName: true } },
        },
      },
    },
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
