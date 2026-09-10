import { prisma } from "../../config/prisma";
import { hashPassword } from "../../utils/password";
import { normalizeKenyanPhone } from "../auth/auth.validation";
import { AppError } from "../../utils/AppError";
import { Role, ApprovalStatus } from "@prisma/client";

export async function applyAsVendor(input: {
  fullName: string;
  phone: string;
  email?: string;
  password: string;
  businessName: string;
  description?: string;
  physicalAddress?: string;
  latitude?: number;
  longitude?: number;
}) {
  const phone = normalizeKenyanPhone(input.phone);
  const existing = await prisma.user.findUnique({ where: { phone } });
  if (existing) throw AppError.conflict("An account with this phone number already exists");

  const passwordHash = await hashPassword(input.password);

  // Vendor accounts start PENDING and cannot receive orders (isOpen stays
  // false, and public listings only show status=APPROVED vendors) until an
  // admin approves them — see admin.service.approveVendor.
  const user = await prisma.user.create({
    data: {
      fullName: input.fullName,
      phone,
      email: input.email,
      passwordHash,
      role: Role.VENDOR,
      vendor: {
        create: {
          businessName: input.businessName,
          description: input.description,
          physicalAddress: input.physicalAddress,
          latitude: input.latitude,
          longitude: input.longitude,
          status: ApprovalStatus.PENDING,
          isOpen: false,
        },
      },
    },
    include: { vendor: true },
  });

  return user;
}

export function listPublicVendors(params: { zoneId?: string; search?: string }) {
  return prisma.vendor.findMany({
    where: {
      status: ApprovalStatus.APPROVED,
      ...(params.zoneId ? { deliveryZoneId: params.zoneId } : {}),
      ...(params.search
        ? { businessName: { contains: params.search, mode: "insensitive" } }
        : {}),
    },
    orderBy: { businessName: "asc" },
    select: {
      id: true,
      businessName: true,
      description: true,
      logoUrl: true,
      coverImageUrl: true,
      isOpen: true,
      avgPrepTimeMins: true,
      deliveryZone: true,
    },
  });
}

export async function getVendorPublicProfile(vendorId: string) {
  const vendor = await prisma.vendor.findFirst({
    where: { id: vendorId, status: ApprovalStatus.APPROVED },
    include: {
      deliveryZone: true,
      categories: {
        orderBy: { sortOrder: "asc" },
        include: { foodItems: { where: { isAvailable: true }, include: { variations: true } } },
      },
    },
  });
  if (!vendor) throw AppError.notFound("Vendor not found");
  return vendor;
}

export function getVendorByUserId(userId: string) {
  return prisma.vendor.findUnique({ where: { userId } });
}

export async function updateOwnProfile(userId: string, data: Record<string, unknown>) {
  const vendor = await prisma.vendor.findUnique({ where: { userId } });
  if (!vendor) throw AppError.notFound("Vendor profile not found");
  return prisma.vendor.update({ where: { id: vendor.id }, data });
}

export async function getEarningsSummary(userId: string) {
  const vendor = await prisma.vendor.findUnique({ where: { userId } });
  if (!vendor) throw AppError.notFound("Vendor profile not found");

  const ledger = await prisma.commissionLedger.findMany({
    where: { vendorId: vendor.id },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const totals = ledger.reduce(
    (acc, row) => {
      acc.gross += Number(row.grossAmount);
      acc.commission += Number(row.commissionAmt);
      acc.net += Number(row.netPayoutAmt);
      return acc;
    },
    { gross: 0, commission: 0, net: 0 }
  );

  return { totals, recent: ledger };
}
