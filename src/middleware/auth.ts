import { Request, Response, NextFunction } from "express";
import { verifyAccessToken } from "../utils/jwt";
import { AppError } from "../utils/AppError";

// Access tokens travel as a short-lived httpOnly cookie ("kg_access"), not
// in localStorage — this is deliberate: it's what we settled on after the
// XSS-exposure tradeoffs of localStorage-based tokens on other projects.
// A Bearer header is also accepted so mobile / non-browser clients work.
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const bearer = req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.slice(7)
      : undefined;
    const token = req.cookies?.kg_access ?? bearer;

    if (!token) throw AppError.unauthorized("Not signed in");

    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, role: payload.role };
    next();
  } catch {
    next(AppError.unauthorized("Session expired or invalid — please sign in again"));
  }
}

// Same as requireAuth but does not fail when there's no token — used on
// public endpoints that personalize output for logged-in users (e.g. menu
// browsing can show "already in cart" state) without requiring login.
export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const bearer = req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.slice(7)
      : undefined;
    const token = req.cookies?.kg_access ?? bearer;
    if (token) {
      const payload = verifyAccessToken(token);
      req.user = { id: payload.sub, role: payload.role };
    }
  } catch {
    // ignore invalid token on optional routes
  }
  next();
}
