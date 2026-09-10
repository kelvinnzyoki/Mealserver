import { Request, Response, NextFunction } from "express";
import * as authService from "./auth.service";
import { setAuthCookies, clearAuthCookies } from "../../utils/cookies";
import { ok, created } from "../../utils/apiResponse";
import { prisma } from "../../config/prisma";
import { AppError } from "../../utils/AppError";

function publicUser(user: { id: string; fullName: string; phone: string; email: string | null; role: string }) {
  return { id: user.id, fullName: user.fullName, phone: user.phone, email: user.email, role: user.role };
}

export async function registerHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { user, accessToken, refreshToken } = await authService.register(req.body);
    setAuthCookies(res, accessToken, refreshToken);
    created(res, { user: publicUser(user) });
  } catch (err) {
    next(err);
  }
}

export async function loginHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { user, accessToken, refreshToken } = await authService.login(req.body);
    setAuthCookies(res, accessToken, refreshToken);
    ok(res, { user: publicUser(user) });
  } catch (err) {
    next(err);
  }
}

export async function refreshHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const rawRefresh = req.cookies?.kg_refresh;
    if (!rawRefresh) throw AppError.unauthorized("Not signed in");
    const { user, accessToken, refreshToken } = await authService.refresh(rawRefresh);
    setAuthCookies(res, accessToken, refreshToken);
    ok(res, { user: publicUser(user) });
  } catch (err) {
    next(err);
  }
}

export async function logoutHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await authService.logout(req.cookies?.kg_refresh);
    clearAuthCookies(res);
    ok(res, { loggedOut: true });
  } catch (err) {
    next(err);
  }
}

export async function meHandler(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw AppError.unauthorized();
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: { vendor: true, rider: true },
    });
    if (!user) throw AppError.unauthorized();
    ok(res, { user: publicUser(user), vendor: user.vendor, rider: user.rider });
  } catch (err) {
    next(err);
  }
}

export async function requestPasswordResetHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await authService.requestPasswordReset(req.body.phone);
    // Same response whether or not the phone exists — avoids leaking which
    // numbers are registered.
    ok(res, { message: "If that number is registered, a reset code has been sent." });
  } catch (err) {
    next(err);
  }
}

export async function resetPasswordHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await authService.resetPassword(req.body.token, req.body.newPassword);
    ok(res, { message: "Password updated. Please sign in." });
  } catch (err) {
    next(err);
  }
}
