import { Request, Response, NextFunction } from "express";
import * as cartService from "./cart.service";
import { ok } from "../../utils/apiResponse";

export async function getCartHandler(req: Request, res: Response, next: NextFunction) {
  try {
    ok(res, await cartService.getCart(req.user!.id));
  } catch (err) {
    next(err);
  }
}

export async function addItemHandler(req: Request, res: Response, next: NextFunction) {
  try {
    ok(res, await cartService.addItem(req.user!.id, req.body));
  } catch (err) {
    next(err);
  }
}

export async function updateItemHandler(req: Request, res: Response, next: NextFunction) {
  try {
    ok(res, await cartService.updateItemQuantity(req.user!.id, req.params.itemId, req.body.quantity));
  } catch (err) {
    next(err);
  }
}

export async function removeItemHandler(req: Request, res: Response, next: NextFunction) {
  try {
    ok(res, await cartService.removeItem(req.user!.id, req.params.itemId));
  } catch (err) {
    next(err);
  }
}

export async function clearCartHandler(req: Request, res: Response, next: NextFunction) {
  try {
    ok(res, await cartService.clearCart(req.user!.id));
  } catch (err) {
    next(err);
  }
}
