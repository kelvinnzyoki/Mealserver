import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../utils/AppError";
import * as menu from "./admin.menu.service";

// Mount inside your existing ADMIN-protected router, e.g.
//   adminRouter.use("/menu", adminMenuRouter);
// so the endpoints are /admin/menu/... and inherit its auth + role check.
//
// ADJUST to your conventions: how the signed-in user is read (below), and the
// response envelope (plain res.json here).
export const adminMenuRouter = Router();

const actorId = (req: Request): string => {
  const id = (req as unknown as { user?: { id?: string } }).user?.id;
  if (!id) throw AppError.forbidden();
  return id;
};

const wrap =
  (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

adminMenuRouter.get("/items", wrap(async (req, res) => {
  res.json(await menu.listMenuItems(typeof req.query.search === "string" ? req.query.search : undefined));
}));

adminMenuRouter.post("/items", wrap(async (req, res) => {
  res.status(201).json(await menu.createHouseItem(actorId(req), req.body));
}));

adminMenuRouter.patch("/items/:id/price", wrap(async (req, res) => {
  const raw = req.body?.customerPrice;
  res.json(await menu.setCustomerPrice(req.params.id, raw === null ? null : Number(raw)));
}));

adminMenuRouter.patch("/items/:id", wrap(async (req, res) => {
  res.json(await menu.updateMenuItemFlags(req.params.id, req.body ?? {}));
}));

// POST rather than DELETE so it works with an API client that only has get/post/patch.
adminMenuRouter.post("/items/:id/delete", wrap(async (req, res) => {
  await menu.deleteHouseItem(req.params.id);
  res.json({ deleted: true });
}));

adminMenuRouter.get("/kitchen", wrap(async (req, res) => {
  res.json(await menu.getHouseKitchen(actorId(req)));
}));

adminMenuRouter.patch("/kitchen", wrap(async (req, res) => {
  res.json(await menu.setHouseKitchenOpen(actorId(req), Boolean(req.body?.isOpen)));
}));
