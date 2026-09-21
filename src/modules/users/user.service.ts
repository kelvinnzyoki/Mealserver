import crypto from "crypto";
import { OrderStatus, Prisma, Role } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { AppError } from "../../utils/AppError";
import { hashPassword, verifyPassword } from "../../utils/password";
import { hashToken } from "../../utils/jwt";

const EMAIL_CODE_TTL_MS = 10 * 60 * 1000;
const EMAIL_CODE_MAX_ATTEMPTS = 5;
const EMAIL_CODE_RESEND_COOLDOWN_MS = 60 * 1000;

// Orders in these states are still moving through the system, so the account
// can't be closed underneath them (the vendor/rider would be left with an
// order for a customer that no longer exists).
const IN_FLIGHT_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.PENDING_PAYMENT,
  OrderStatus.PLACED,
  OrderStatus.ACCEPTED,
  OrderStatus.PREPARING,
  OrderStatus.READY_FOR_PICKUP,
  OrderStatus.ASSIGNED,
  OrderStatus.PICKED_UP,
];

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

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

// Only these columns may be changed through the API. Without this, a request
// body containing `userId` would let someone move an address onto another
// account.
const EDITABLE_ADDRESS_FIELDS = [
  "label",
  "building",
  "street",
  "area",
  "city",
  "landmark",
  "latitude",
  "longitude",
  "contactPhone",
  "contactName",
  "isDefault",
] as const;

function pickEditableAddressFields(data: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const key of EDITABLE_ADDRESS_FIELDS) {
    if (data[key] !== undefined) out[key] = data[key];
  }
  return out;
}

export async function updateAddress(userId: string, addressId: string, data: Record<string, unknown>) {
  const existing = await prisma.address.findUnique({ where: { id: addressId } });
  if (!existing || existing.userId !== userId) throw AppError.notFound("Address not found");

  const clean = pickEditableAddressFields(data);
  if (clean.isDefault) {
    await prisma.address.updateMany({ where: { userId }, data: { isDefault: false } });
  }
  return prisma.address.update({ where: { id: addressId }, data: clean as never });
}

export async function deleteAddress(userId: string, addressId: string) {
  const existing = await prisma.address.findUnique({ where: { id: addressId } });
  if (!existing || existing.userId !== userId) throw AppError.notFound("Address not found");
  await prisma.address.delete({ where: { id: addressId } });
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function getActiveUser(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.isActive) throw AppError.unauthorized();
  return user;
}

// A wrong password here is a 400, not a 401. The frontend's apiClient treats
// any 401 as "access token expired", silently refreshes, and retries — which
// would just repeat the wrong password and muddy the message.
async function assertPassword(passwordHash: string, password: string, message = "Incorrect password") {
  const valid = await verifyPassword(password, passwordHash);
  if (!valid) throw AppError.badRequest(message);
}

// Every live refresh token for this user except the one making the request,
// so the device doing the change stays signed in.
function otherSessionsWhere(userId: string, currentRefreshToken?: string): Prisma.RefreshTokenWhereInput {
  return {
    userId,
    revoked: false,
    ...(currentRefreshToken ? { tokenHash: { not: hashToken(currentRefreshToken) } } : {}),
  };
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export function updateProfile(userId: string, data: { fullName: string }) {
  // Pick fields explicitly rather than passing `data` through.
  return prisma.user.update({ where: { id: userId }, data: { fullName: data.fullName } });
}

// ---------------------------------------------------------------------------
// Email change (two steps, mirrors the signup verification flow)
// ---------------------------------------------------------------------------

export async function startEmailChange(userId: string, newEmailRaw: string, password: string) {
  const user = await getActiveUser(userId);
  await assertPassword(user.passwordHash, password);

  const newEmail = newEmailRaw.trim().toLowerCase();
  if (user.email === newEmail) throw AppError.badRequest("That is already your email address");

  const taken = await prisma.user.findUnique({ where: { email: newEmail } });
  if (taken) throw AppError.conflict("An account with this email already exists");

  // Cooldown only applies to re-sending to the same address, so fixing a typo
  // isn't blocked. authLimiter on the route caps overall volume.
  const existing = await prisma.pendingEmailChange.findUnique({ where: { userId } });
  if (
    existing &&
    existing.newEmail === newEmail &&
    Date.now() - existing.updatedAt.getTime() < EMAIL_CODE_RESEND_COOLDOWN_MS
  ) {
    throw AppError.badRequest("A code was just sent — please wait a moment before requesting another.");
  }

  const code = String(crypto.randomInt(100000, 1000000)); // always 6 digits
  const fields = {
    newEmail,
    codeHash: hashToken(code),
    attempts: 0,
    expiresAt: new Date(Date.now() + EMAIL_CODE_TTL_MS),
  };
  await prisma.pendingEmailChange.upsert({
    where: { userId },
    create: { userId, ...fields },
    update: fields,
  });

  // NOTE: reuses the signup email template. Swap for a dedicated
  // "confirm your new email" function in notification.service when you like.
  const { sendSignupVerificationEmail } = await import("../notifications/notification.service");
  const sent = await sendSignupVerificationEmail(newEmail, code);
  if (!sent) throw AppError.badRequest("Could not send the verification email — please try again shortly.");
}

export async function verifyEmailChange(userId: string, code: string) {
  await getActiveUser(userId);

  const pending = await prisma.pendingEmailChange.findUnique({ where: { userId } });
  if (!pending || pending.expiresAt < new Date()) {
    throw AppError.badRequest("This code has expired — request a new one.");
  }
  if (pending.attempts >= EMAIL_CODE_MAX_ATTEMPTS) {
    throw AppError.badRequest("Too many incorrect attempts — request a new code.");
  }
  if (hashToken(code) !== pending.codeHash) {
    await prisma.pendingEmailChange.update({ where: { userId }, data: { attempts: { increment: 1 } } });
    const remaining = EMAIL_CODE_MAX_ATTEMPTS - pending.attempts - 1;
    throw AppError.badRequest(`Incorrect code — ${Math.max(remaining, 0)} attempt(s) left.`);
  }

  // If someone registered this address between start and verify, the unique
  // constraint fires a Prisma P2002, which the global error handler already
  // turns into a 409.
  const [user] = await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { email: pending.newEmail } }),
    prisma.pendingEmailChange.deleteMany({ where: { userId } }),
  ]);
  return user;
}

// ---------------------------------------------------------------------------
// Password & sessions
// ---------------------------------------------------------------------------

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  currentRefreshToken?: string
) {
  const user = await getActiveUser(userId);
  await assertPassword(user.passwordHash, currentPassword, "Current password is incorrect");

  if (currentPassword === newPassword) {
    throw AppError.badRequest("Choose a password that's different from your current one");
  }

  const passwordHash = await hashPassword(newPassword);
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
    // Sign out every other device; the one making this request keeps its session.
    prisma.refreshToken.updateMany({
      where: otherSessionsWhere(userId, currentRefreshToken),
      data: { revoked: true },
    }),
  ]);
}

export async function revokeOtherSessions(userId: string, currentRefreshToken?: string) {
  await prisma.refreshToken.updateMany({
    where: otherSessionsWhere(userId, currentRefreshToken),
    data: { revoked: true },
  });
}

// ---------------------------------------------------------------------------
// Account deletion
// ---------------------------------------------------------------------------

// Orders, payments and reviews reference the user without cascade (they're
// financial records), so a hard delete would fail for anyone who has ordered.
// Instead: erase personal data, keep the row, and mark it inactive so it can
// never sign in again.
export async function deleteAccount(userId: string, password: string) {
  const user = await getActiveUser(userId);

  if (user.role !== Role.CUSTOMER) {
    throw AppError.forbidden("Vendor, rider and admin accounts can't be deleted here. Please contact support.");
  }

  await assertPassword(user.passwordHash, password);

  const inFlight = await prisma.order.findFirst({
    where: { customerId: userId, status: { in: IN_FLIGHT_ORDER_STATUSES } },
    select: { id: true },
  });
  if (inFlight) {
    throw AppError.conflict("You have an order in progress. You can delete your account once it's delivered or cancelled.");
  }

  // phone is required + unique, so it gets a unique placeholder rather than null.
  const scrubbedPasswordHash = await hashPassword(crypto.randomBytes(32).toString("hex"));

  await prisma.$transaction([
    // Meal plans first: they hold a required reference to Address.
    prisma.mealPlan.deleteMany({ where: { userId } }),
    // Orders that pointed at these addresses keep existing; their addressId becomes null.
    prisma.address.deleteMany({ where: { userId } }),
    prisma.cart.deleteMany({ where: { userId } }),
    prisma.notification.deleteMany({ where: { userId } }),
    prisma.refreshToken.deleteMany({ where: { userId } }),
    prisma.passwordResetToken.deleteMany({ where: { userId } }),
    prisma.pendingEmailChange.deleteMany({ where: { userId } }),
    prisma.user.update({
      where: { id: userId },
      data: {
        isActive: false,
        fullName: "Deleted user",
        email: null,
        phone: `deleted-${userId}`,
        passwordHash: scrubbedPasswordHash,
      },
    }),
  ]);
}
