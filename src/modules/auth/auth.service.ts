import { prisma } from "../../config/prisma";
import { hashPassword, verifyPassword } from "../../utils/password";
import { signAccessToken, generateRefreshToken, hashToken } from "../../utils/jwt";
import { AppError } from "../../utils/AppError";
import { normalizeKenyanPhone } from "./auth.validation";
import { Role } from "@prisma/client";
import crypto from "crypto";

const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;
const SIGNUP_CODE_TTL_MS = 10 * 60 * 1000;
const SIGNUP_CODE_MAX_ATTEMPTS = 5;
const SIGNUP_RESEND_COOLDOWN_MS = 60 * 1000;

function generateSignupCode(): string {
  return String(crypto.randomInt(100000, 1000000)); // always 6 digits
}

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

// Step 1 of signup: validate the details, email a 6-digit code, and park
// everything needed to create the account in PendingSignup — no User row
// exists yet. (Creating the account before verification completes was a
// real bug on an earlier project; this shape makes that mistake
// structurally impossible here.)
export async function startRegistration(input: {
  fullName: string;
  phone: string;
  email: string;
  password: string;
}) {
  const phone = normalizeKenyanPhone(input.phone);
  const email = input.email.toLowerCase();

  const existingUser = await prisma.user.findFirst({ where: { OR: [{ phone }, { email }] } });
  if (existingUser) {
    throw AppError.conflict(
      existingUser.phone === phone
        ? "An account with this phone number already exists"
        : "An account with this email already exists"
    );
  }

  const existingPending = await prisma.pendingSignup.findUnique({ where: { email } });
  if (existingPending && Date.now() - existingPending.updatedAt.getTime() < SIGNUP_RESEND_COOLDOWN_MS) {
    throw AppError.badRequest("A code was just sent — please wait a moment before requesting another.");
  }

  const code = generateSignupCode();
  const passwordHash = await hashPassword(input.password);

  await prisma.pendingSignup.upsert({
    where: { email },
    create: {
      email,
      fullName: input.fullName,
      phone,
      passwordHash,
      codeHash: hashToken(code),
      attempts: 0,
      expiresAt: new Date(Date.now() + SIGNUP_CODE_TTL_MS),
    },
    update: {
      fullName: input.fullName,
      phone,
      passwordHash,
      codeHash: hashToken(code),
      attempts: 0,
      expiresAt: new Date(Date.now() + SIGNUP_CODE_TTL_MS),
    },
  });

  const { sendSignupVerificationEmail } = await import("../notifications/notification.service");
  const sent = await sendSignupVerificationEmail(email, code);
  if (!sent) throw AppError.badRequest("Could not send the verification email — please try again shortly.");
}

// Step 2: confirm the code and actually create the account.
export async function verifyRegistrationAndCreateUser(emailRaw: string, code: string) {
  const email = emailRaw.toLowerCase();
  const pending = await prisma.pendingSignup.findUnique({ where: { email } });

  if (!pending || pending.expiresAt < new Date()) {
    throw AppError.badRequest("This code has expired — request a new one.");
  }
  if (pending.attempts >= SIGNUP_CODE_MAX_ATTEMPTS) {
    throw AppError.badRequest("Too many incorrect attempts — request a new code.");
  }
  if (hashToken(code) !== pending.codeHash) {
    await prisma.pendingSignup.update({ where: { email }, data: { attempts: { increment: 1 } } });
    const remaining = SIGNUP_CODE_MAX_ATTEMPTS - pending.attempts - 1;
    throw AppError.badRequest(`Incorrect code — ${Math.max(remaining, 0)} attempt(s) left.`);
  }

  // A race on phone/email uniqueness here (two people verifying near-
  // simultaneously) surfaces as a Prisma P2002, which the global error
  // handler already turns into a clean 409 — no special handling needed.
  const user = await prisma.user.create({
    data: {
      fullName: pending.fullName,
      phone: pending.phone,
      email: pending.email,
      passwordHash: pending.passwordHash,
      role: Role.CUSTOMER,
      cart: { create: {} },
    },
  });

  await prisma.pendingSignup.delete({ where: { email } }).catch(() => undefined);

  const tokens = await issueTokenPair(user.id, user.role);
  return { user, ...tokens };
}

export async function resendRegistrationCode(emailRaw: string) {
  const email = emailRaw.toLowerCase();
  const pending = await prisma.pendingSignup.findUnique({ where: { email } });
  if (!pending) throw AppError.badRequest("Start the signup form again first.");

  if (Date.now() - pending.updatedAt.getTime() < SIGNUP_RESEND_COOLDOWN_MS) {
    throw AppError.badRequest("Please wait a moment before requesting another code.");
  }

  const code = generateSignupCode();
  await prisma.pendingSignup.update({
    where: { email },
    data: { codeHash: hashToken(code), attempts: 0, expiresAt: new Date(Date.now() + SIGNUP_CODE_TTL_MS) },
  });

  const { sendSignupVerificationEmail } = await import("../notifications/notification.service");
  const sent = await sendSignupVerificationEmail(email, code);
  if (!sent) throw AppError.badRequest("Could not send the verification email — please try again shortly.");
}

// Login accepts either a phone number or an email address in the same
// "identifier" field. We decide which one it is by checking for "@" rather
// than trying both — trying both (e.g. an OR query) risks a confusing edge
// case where a malformed phone-like string happens to also be a stored
// email substring match, and it's one query instead of a broader one either
// way. Both branches throw the exact same generic message on failure, so a
// bad actor can't use response differences to enumerate which phones or
// emails are registered.
export async function login(input: { identifier: string; password: string }) {
  const raw = input.identifier.trim();
  const isEmail = raw.includes("@");

  const user = isEmail
    ? await prisma.user.findUnique({ where: { email: raw.toLowerCase() } })
    : await prisma.user.findUnique({ where: { phone: normalizeKenyanPhone(raw) } });

  if (!user || !user.isActive) throw AppError.unauthorized("Invalid phone/email or password");

  const valid = await verifyPassword(input.password, user.passwordHash);
  if (!valid) throw AppError.unauthorized("Invalid phone/email or password");

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
