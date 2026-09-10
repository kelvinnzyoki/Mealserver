import { Request, Response, NextFunction } from "express";
import * as orderService from "./order.service";
import { ok, created } from "../../utils/apiResponse";

export async function checkoutHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const order = await orderService.checkout(req.user!.id, req.body);
    created(res, order);
  } catch (err) {
    next(err);
  }
}

export async function getMyOrdersHandler(req: Request, res: Response, next: NextFunction) {
  try {
    ok(res, await orderService.getMyOrders(req.user!.id));
  } catch (err) {
    next(err);
  }
}

export async function getOrderDetailHandler(req: Request, res: Response, next: NextFunction) {
  try {
    ok(res, await orderService.getOrderDetail(req.params.id, req.user!));
  } catch (err) {
    next(err);
  }
}

export async function vendorUpdateStatusHandler(req: Request, res: Response, next: NextFunction) {
  try {
    ok(res, await orderService.vendorUpdateStatus(req.user!.id, req.params.id, req.body.status, req.body.reason));
  } catch (err) {
    next(err);
  }
}

export async function cancelOrderHandler(req: Request, res: Response, next: NextFunction) {
  try {
    ok(res, await orderService.cancelOrder(req.user!.id, req.params.id, req.body.reason));
  } catch (err) {
    next(err);
  }
}

export async function reorderHandler(req: Request, res: Response, next: NextFunction) {
  try {
    ok(res, await orderService.reorder(req.user!.id, req.params.id));
  } catch (err) {
    next(err);
  }
}

export async function getVendorOrdersHandler(req: Request, res: Response, next: NextFunction) {
  try {
    ok(res, await orderService.getVendorOrders(req.user!.id, req.query.status as string | undefined));
  } catch (err) {
    next(err);
  }
}
