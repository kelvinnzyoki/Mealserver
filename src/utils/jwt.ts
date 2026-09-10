import jwt, { SignOptions } from "jsonwebtoken";
import crypto from "crypto";
import { env } from "../config/env";
import { Role } from "@prisma/client";

export interface AccessTokenPayload {
  sub: string; // user id
  role: Role;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  // Newer @types/jsonwebtoken types `expiresIn` as a branded string pattern
  // (e.g. "15m", "30d"), not a generic `string` — env.jwt.accessExpiresIn is
  // a plain string since it comes from process.env, so it needs an explicit
  // cast here rather than actually being an unsafe value.
  const options: SignOptions = { expiresIn: env.jwt.accessExpiresIn as SignOptions["expiresIn"] };
  return jwt.sign(payload, env.jwt.accessSecret, options);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.jwt.accessSecret) as AccessTokenPayload;
}

// Refresh tokens are opaque random strings, not JWTs — we store only a
// SHA-256 hash of them in the DB (RefreshToken.tokenHash), so a leaked DB
// dump alone can't be replayed as a valid refresh token. The cookie holds
// the raw token; we hash on lookup to compare.
export function generateRefreshToken(): string {
  return crypto.randomBytes(48).toString("hex");
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}
