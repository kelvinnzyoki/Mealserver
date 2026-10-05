import { Request, Response, NextFunction } from "express";
import * as adminFoodImagesService from "./adminFoodImages.service";
import { ok } from "../../utils/apiResponse";

export async function listFoodItemsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { vendorId, search } = req.query as { vendorId?: string; search?: string };
    ok(res, await adminFoodImagesService.listFoodItems({ vendorId, search }));
  } catch (err) {
    next(err);
  }
}

export async function setFoodItemImageHandler(req: Request, res: Response, next: NextFunction) {
  try {
    ok(res, await adminFoodImagesService.setFoodItemImage(req.params.id, req.body.imageUrl));
  } catch (err) {
    next(err);
  }
}
