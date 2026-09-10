import { prisma } from "../../config/prisma";
import { hashPassword, verifyPassword } from "../../utils/password";
import { signAccessToken, generateRefreshToken, hashToken } from "../../utils/jwt";
import { AppError } from "../../utils/AppError";
import { normalizeKenyanPhone } from "./auth.validation";
import { Role } from "@prisma/client";
import crypto from "crypto";

const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

async function issueTokenPair(userId: string, role: Role) {
  const accessToken = signAccessToken({ sub: userId, role });
  const refreshToken = generateRefreshToken();

  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    },
  });

  return { accessToken, refreshToken };
}

export async function register(input: {
  fullName: string;
  phone: string;
  email?: string;
  password: string;
}) {
  const phone = normalizeKenyanPhone(input.phone);

  const existing = await prisma.user.findUnique({ where: { phone } });
  if (existing) throw AppError.conflict("An account with this phone number already exists");

  const passwordHash = await hashPassword(input.password);
  const user = await prisma.user.create({
    data: {
      fullName: input.fullName,
      phone,
      email: input.email,
      passwordHash,
      role: Role.CUSTOMER,
      cart: { create: {} }, // every customer gets an empty cart up front
    },
  });

  const tokens = await issueTokenPair(user.id, user.role);
  return { user, ...tokens };
}

export async function login(input: { phone: string; password: string }) {
  const phone = normalizeKenyanPhone(input.phone);
  const user = await prisma.user.findUnique({ where: { phone } });
  if (!user || !user.isActive) throw AppError.unauthorized("Invalid phone number or password");

  const valid = await verifyPassword(input.password, user.passwordHash);
  if (!valid) throw AppError.unauthorized("Invalid phone number or password");

  const tokens = await issueTokenPair(user.id, user.role);
  return { user, ...tokens };
}

export async function refresh(rawRefreshToken: string) {
  const tokenHash = hashToken(rawRefreshToken);
  const record = await prisma.refreshToken.findUnique({ where: { tokenHash } });

  if (!record || record.revoked || record.expiresAt < new Date()) {
    throw AppError.unauthorized("Session expired — please sign in again");
  }

  const user = await prisma.user.findUnique({ where: { id: record.userId } });
  if (!user || !user.isActive) throw AppError.unauthorized();

  // Rotate: revoke the used refresh token and issue a brand new pair. This
  // means a stolen-but-unused refresh token becomes useless the moment the
  // legitimate owner refreshes again — a reused/replayed old token is a
  // strong signal of theft.
  await prisma.refreshToken.update({ where: { id: record.id }, data: { revoked: true } });
  const tokens = await issueTokenPair(user.id, user.role);
  return { user, ...tokens };
}

export async function logout(rawRefreshToken?: string) {
  if (!rawRefreshToken) return;
  const tokenHash = hashToken(rawRefreshToken);
  await prisma.refreshToken
    .updateMany({ where: { tokenHash }, data: { revoked: true } })
    .catch(() => undefined);
}

export async function requestPasswordReset(phoneRaw: string) {
  const phone = normalizeKenyanPhone(phoneRaw);
  const user = await prisma.user.findUnique({ where: { phone } });
  // Deliberately do not reveal whether the phone number is registered.
  if (!user) return;

  const rawToken = crypto.randomBytes(32).toString("hex");
  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
    },
  });

  // Hand off to the notification service (SMS) — see notifications module.
  // Kept as a separate import call site so swapping providers never touches
  // this service.
  const { sendPasswordResetSms } = await import("../notifications/notification.service");
  await sendPasswordResetSms(user.phone, rawToken);
}

export async function resetPassword(rawToken: string, newPassword: string) {
  const tokenHash = hashToken(rawToken);
  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });

  if (!record || record.usedAt || record.expiresAt < new Date()) {
    throw AppError.badRequest("This reset link is invalid or has expired");
  }

  const passwordHash = await hashPassword(newPassword);
  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
    prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    // Invalidate every existing session — a password reset should log out
    // anyone (including an attacker) holding an old refresh token.
    prisma.refreshToken.updateMany({ where: { userId: record.userId }, data: { revoked: true } }),
  ]);
}
