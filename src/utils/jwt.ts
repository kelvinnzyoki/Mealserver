import jwt, { SignOptions } from "jsonwebtoken";
import crypto from "crypto";
import { env } from "../config/env";
import { Role } from "@prisma/client";

export interface AccessTokenPayload {
  sub: string; // user id
  role: Role;
}

// A weak or default signing secret lets anyone forge a token for any user
// (including an admin). Refuse to run in production with one.
if (env.isProd && (!env.jwt.accessSecret || env.jwt.accessSecret.length < 32)) {
  throw new Error("JWT_ACCESS_SECRET must be set to a random string of at least 32 characters in production");
}

export function signAccessToken(payload: AccessTokenPayload): string {
  // Newer @types/jsonwebtoken types `expiresIn` as a branded string pattern
  // (e.g. "15m", "30d"), not a generic `string` — env.jwt.accessExpiresIn is
  // a plain string since it comes from process.env, so it needs an explicit
  // cast here rather than actually being an unsafe value.
  const options: SignOptions = { algorithm: "HS256", expiresIn: env.jwt.accessExpiresIn as SignOptions["expiresIn"] };
  return jwt.sign(payload, env.jwt.accessSecret, options);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  // Pin the algorithm so a token can never pick its own, and check the payload
  // shape instead of trusting a cast.
  const decoded = jwt.verify(token, env.jwt.accessSecret, { algorithms: ["HS256"] });
  if (
    typeof decoded !== "object" ||
    typeof decoded.sub !== "string" ||
    !(Object.values(Role) as unknown[]).includes((decoded as { role?: unknown }).role)
  ) {
    throw new Error("Malformed access token");
  }
  return decoded as unknown as AccessTokenPayload;
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
