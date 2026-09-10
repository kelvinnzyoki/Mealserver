import { Request, Response, NextFunction } from "express";
import * as subscriptionService from "./subscription.service";
import { ok, created } from "../../utils/apiResponse";

export async function createHandler(req: Request, res: Response, next: NextFunction) {
  try {
    created(res, await subscriptionService.createMealPlan(req.user!.id, req.body));
  } catch (err) {
    next(err);
  }
}

export async function listMineHandler(req: Request, res: Response, next: NextFunction) {
  try {
    ok(res, await subscriptionService.listMyMealPlans(req.user!.id));
  } catch (err) {
    next(err);
  }
}

export async function setStatusHandler(req: Request, res: Response, next: NextFunction) {
  try {
    ok(res, await subscriptionService.setMealPlanStatus(req.user!.id, req.params.id, req.body.status));
  } catch (err) {
    next(err);
  }
}
