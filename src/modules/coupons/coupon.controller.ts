import { Request, Response, NextFunction } from "express";
import * as couponService from "./coupon.service";
import { ok, created } from "../../utils/apiResponse";

export async function createCouponHandler(req: Request, res: Response, next: NextFunction) {
  try {
    created(res, await couponService.createCoupon(req.user!, req.body));
  } catch (err) {
    next(err);
  }
}

export async function listMyCouponsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    ok(res, await couponService.listMyCoupons(req.user!));
  } catch (err) {
    next(err);
  }
}

export async function setCouponActiveHandler(req: Request, res: Response, next: NextFunction) {
  try {
    ok(res, await couponService.setCouponActive(req.params.id, req.body.isActive));
  } catch (err) {
    next(err);
  }
}

export async function previewCouponHandler(req: Request, res: Response, next: NextFunction) {
  try {
    ok(res, await couponService.previewCoupon(req.body.code, req.body.vendorId, req.body.subtotal));
  } catch (err) {
    next(err);
  }
}
