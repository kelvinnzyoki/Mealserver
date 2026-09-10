import { Request, Response, NextFunction } from "express";
import * as riderService from "./rider.service";
import { setAuthCookies } from "../../utils/cookies";
import { signAccessToken, generateRefreshToken, hashToken } from "../../utils/jwt";
import { prisma } from "../../config/prisma";
import { ok, created } from "../../utils/apiResponse";
import { AppError } from "../../utils/AppError";

export async function applyHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await riderService.applyAsRider(req.body);
    const accessToken = signAccessToken({ sub: user.id, role: user.role });
    const refreshToken = generateRefreshToken();
    await prisma.refreshToken.create({
      data: { userId: user.id, tokenHash: hashToken(refreshToken), expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
    });
    setAuthCookies(res, accessToken, refreshToken);
    created(res, { message: "Application received. You can start accepting deliveries once approved.", rider: user.rider });
  } catch (err) {
    next(err);
  }
}

export async function getMyProfileHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const rider = await riderService.getRiderByUserId(req.user!.id);
    if (!rider) throw AppError.notFound("Rider profile not found");
    ok(res, rider);
  } catch (err) {
    next(err);
  }
}

export async function updateMyProfileHandler(req: Request, res: Response, next: NextFunction) {
  try {
    ok(res, await riderService.updateOwnProfile(req.user!.id, req.body));
  } catch (err) {
    next(err);
  }
}

export async function deliveryHistoryHandler(req: Request, res: Response, next: NextFunction) {
  try {
    ok(res, await riderService.getDeliveryHistory(req.user!.id));
  } catch (err) {
    next(err);
  }
}

export async function earningsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    ok(res, await riderService.getEarningsSummary(req.user!.id));
  } catch (err) {
    next(err);
  }
}
