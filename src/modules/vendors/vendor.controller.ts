import { Request, Response, NextFunction } from "express";
import * as vendorService from "./vendor.service";
import { setAuthCookies } from "../../utils/cookies";
import { signAccessToken, generateRefreshToken, hashToken } from "../../utils/jwt";
import { prisma } from "../../config/prisma";
import { ok, created } from "../../utils/apiResponse";
import { AppError } from "../../utils/AppError";

export async function applyHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await vendorService.applyAsVendor(req.body);

    const accessToken = signAccessToken({ sub: user.id, role: user.role });
    const refreshToken = generateRefreshToken();
    await prisma.refreshToken.create({
      data: { userId: user.id, tokenHash: hashToken(refreshToken), expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
    });
    setAuthCookies(res, accessToken, refreshToken);

    created(res, {
      message: "Application received. Your kitchen will go live once an admin approves it.",
      vendor: user.vendor,
    });
  } catch (err) {
    next(err);
  }
}

export async function listPublicVendorsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const vendors = await vendorService.listPublicVendors({
      zoneId: req.query.zoneId as string | undefined,
      search: req.query.search as string | undefined,
    });
    ok(res, vendors);
  } catch (err) {
    next(err);
  }
}

export async function getVendorPublicProfileHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const vendor = await vendorService.getVendorPublicProfile(req.params.id);
    ok(res, vendor);
  } catch (err) {
    next(err);
  }
}

export async function getMyVendorProfileHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const vendor = await vendorService.getVendorByUserId(req.user!.id);
    if (!vendor) throw AppError.notFound("Vendor profile not found");
    ok(res, vendor);
  } catch (err) {
    next(err);
  }
}

export async function updateMyProfileHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const vendor = await vendorService.updateOwnProfile(req.user!.id, req.body);
    ok(res, vendor);
  } catch (err) {
    next(err);
  }
}

export async function earningsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const summary = await vendorService.getEarningsSummary(req.user!.id);
    ok(res, summary);
  } catch (err) {
    next(err);
  }
}
