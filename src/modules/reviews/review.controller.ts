import { Request, Response, NextFunction } from "express";
import * as reviewService from "./review.service";
import { ok, created } from "../../utils/apiResponse";

export async function createReviewHandler(req: Request, res: Response, next: NextFunction) {
  try {
    created(res, await reviewService.createReview(req.user!.id, req.body));
  } catch (err) {
    next(err);
  }
}

export async function listVendorReviewsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    ok(res, await reviewService.listVendorReviews(req.params.vendorId));
  } catch (err) {
    next(err);
  }
}
