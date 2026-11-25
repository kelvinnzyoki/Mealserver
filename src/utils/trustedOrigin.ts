import { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/AppError";

// Blocks state-changing requests that a browser sends from some OTHER website.
// Browsers always attach an Origin header to cross-site POST/PATCH/PUT/DELETE,
// so a page on evil.com can't ride on a customer's login cookies to trigger an
// M-Pesa prompt or an order. Requests with no Origin header (Safaricom's
// callback, curl, server-to-server) are not browser cross-site requests and
// pass through — the callback has its own secret-token check.
//
// Usage in app.ts, right after cors():
//   app.use(requireTrustedOrigin([<the same frontend URL(s) you give cors()>]));
export function requireTrustedOrigin(allowedOrigins: string[]) {
  const allowed = new Set(allowedOrigins.map((o) => o.trim().replace(/\/+$/, "")).filter(Boolean));

  return (req: Request, _res: Response, next: NextFunction) => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
    const origin = req.headers.origin;
    if (!origin || allowed.has(origin)) return next();
    next(AppError.forbidden("Request blocked"));
  };
}
