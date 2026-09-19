import { Response } from "express";
import { env } from "../config/env";

// Cookie notes (learned the hard way on other projects):
// - Frontend and backend live on different domains (e.g. app.vercel.app and
//   api.vercel.app), so the cookie "Domain" attribute should usually be left
//   UNSET — Domain is for sharing a cookie across subdomains of the SAME
//   parent domain, not across unrelated domains. Setting it wrong is what
//   causes "logs out immediately" bugs. Only set COOKIE_DOMAIN if your
//   frontend and backend truly share a parent domain (e.g. both under
//   kulago.co.ke).
// - Cross-site cookies require SameSite=None + Secure, which in turn
//   requires HTTPS — fine on Vercel, but means local dev over http://
//   needs SameSite=Lax instead (browsers reject None without Secure).
const isCrossSiteCapable = env.isProd;

// Valid bare-hostname cookie Domain value, e.g. "kulago.co.ke" or
// ".kulago.co.ke". Rejects anything with a scheme, path, port, quotes,
// or whitespace — the exact shapes that make `cookie`'s serializer throw
// "option domain is invalid" and 500 every login/signup request.
const DOMAIN_PATTERN =
  /^\.?[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i;

function resolveCookieDomain(): string | undefined {
  const raw = env.cookieDomain?.trim();
  if (!raw) return undefined;

  if (!DOMAIN_PATTERN.test(raw)) {
    // Don't crash every auth request over a bad env var — log loudly and
    // fall back to no Domain (safe default: cookie stays host-only).
    console.error(
      `COOKIE_DOMAIN="${raw}" is not a valid bare hostname (no https://, no port, no quotes) — ignoring it.`
    );
    return undefined;
  }

  return raw;
}

const baseCookieOpts = {
  httpOnly: true,
  secure: isCrossSiteCapable,
  sameSite: (isCrossSiteCapable ? "none" : "lax") as "none" | "lax",
  domain: resolveCookieDomain(),
  path: "/",
};

export function setAuthCookies(res: Response, accessToken: string, refreshToken: string) {
  res.cookie("kg_access", accessToken, {
    ...baseCookieOpts,
    maxAge: 15 * 60 * 1000, // 15 minutes, mirrors JWT_ACCESS_EXPIRES_IN default
  });
  res.cookie("kg_refresh", refreshToken, {
    ...baseCookieOpts,
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days, mirrors JWT_REFRESH_EXPIRES_IN default
    path: "/api/auth", // only sent to auth routes (refresh/logout)
  });
}

export function clearAuthCookies(res: Response) {
  res.clearCookie("kg_access", { ...baseCookieOpts });
  res.clearCookie("kg_refresh", { ...baseCookieOpts, path: "/api/auth" });
}
