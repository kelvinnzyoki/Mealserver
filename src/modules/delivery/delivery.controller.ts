import { Request, Response, NextFunction } from "express";
import * as deliveryService from "./delivery.service";
import { ok } from "../../utils/apiResponse";

export async function listAvailableHandler(req: Request, res: Response, next: NextFunction) {
  try {
    ok(res, await deliveryService.listAvailableOrders());
  } catch (err) {
    next(err);
  }
}

export async function acceptHandler(req: Request, res: Response, next: NextFunction) {
  try {
    ok(res, await deliveryService.acceptDelivery(req.user!.id, req.params.orderId, req.body?.includeBatch === true));
  } catch (err) {
    next(err);
  }
}

export async function pickedUpHandler(req: Request, res: Response, next: NextFunction) {
  try {
    ok(res, await deliveryService.markPickedUp(req.user!.id, req.params.orderId));
  } catch (err) {
    next(err);
  }
}

export async function deliveredHandler(req: Request, res: Response, next: NextFunction) {
  try {
    ok(res, await deliveryService.markDelivered(req.user!.id, req.params.orderId));
  } catch (err) {
    next(err);
  }
}

export async function failedHandler(req: Request, res: Response, next: NextFunction) {
  try {
    ok(res, await deliveryService.markFailed(req.user!.id, req.params.orderId, req.body?.reason ?? "Unspecified"));
  } catch (err) {
    next(err);
  }
}
