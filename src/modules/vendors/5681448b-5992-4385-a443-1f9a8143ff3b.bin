import { prisma } from "../../config/prisma";
import { hashPassword } from "../../utils/password";
import { normalizeKenyanPhone } from "../auth/auth.validation";
import { AppError } from "../../utils/AppError";
import { Role, ApprovalStatus } from "@prisma/client";
import { finalCustomerPrice } from "../../utils/pricing";

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

  // Customers never see the vendor's own price: every item is shown at its
  // final customer price (the admin's override if set, otherwise the platform
  // markup added to the vendor's price; see utils/pricing.ts). The vendor is
  // still paid the price they listed. The raw override field is not exposed.
  return {
    ...vendor,
    categories: vendor.categories.map((c) => ({
      ...c,
      foodItems: c.foodItems.map((item) => {
        const { customerPriceOverride, ...rest } = item;
        void customerPriceOverride;
        return { ...rest, basePrice: finalCustomerPrice(item) };
      }),
    })),
  };
}

export function getVendorByUserId(userId: string) {
  return prisma.vendor.findUnique({ where: { userId } });
}

// A vendor may only edit these fields of their own profile. Anything else
// (status, userId, deliveryZoneId, ...) is controlled by the admin; without
// this whitelist a vendor could send { status: "APPROVED" } and approve
// themselves.
const VENDOR_EDITABLE_PROFILE_FIELDS = [
  "businessName",
  "description",
  "physicalAddress",
  "latitude",
  "longitude",
  "logoUrl",
  "coverImageUrl",
  "isOpen",
  "avgPrepTimeMins",
] as const;

export async function updateOwnProfile(userId: string, data: Record<string, unknown>) {
  const vendor = await prisma.vendor.findUnique({ where: { userId } });
  if (!vendor) throw AppError.notFound("Vendor profile not found");

  const safe: Record<string, unknown> = {};
  for (const key of VENDOR_EDITABLE_PROFILE_FIELDS) {
    if (data[key] !== undefined) safe[key] = data[key];
  }
  if (Object.keys(safe).length === 0) throw AppError.badRequest("Nothing to update");

  return prisma.vendor.update({ where: { id: vendor.id }, data: safe as never });
}

// Vendors are paid exactly the prices they listed. Platform commission and the
// customer-facing markup are admin-only concepts and are NOT exposed here.
// `netPayoutAmt` on each ledger row must equal the sum of the vendor's listed
// prices for that order (set where the ledger row is created, in
// order.service.markOrderPlaced).
export async function getEarningsSummary(userId: string) {
  const vendor = await prisma.vendor.findUnique({ where: { userId } });
  if (!vendor) throw AppError.notFound("Vendor profile not found");

  const ledger = await prisma.commissionLedger.findMany({
    where: { vendorId: vendor.id },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, createdAt: true, netPayoutAmt: true },
  });

  const net = ledger.reduce((sum, row) => sum + Number(row.netPayoutAmt), 0);

  return {
    totals: { net },
    recent: ledger.map((row) => ({
      id: row.id,
      createdAt: row.createdAt,
      amount: Number(row.netPayoutAmt),
    })),
  };
}
