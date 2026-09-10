import { Request, Response, NextFunction } from "express";
import * as adminService from "./admin.service";
import { ok } from "../../utils/apiResponse";
import { ApprovalStatus, OrderStatus } from "@prisma/client";

export const dashboardHandler = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    ok(res, await adminService.getDashboardStats());
  } catch (err) {
    next(err);
  }
};

export const listVendorsHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    ok(res, await adminService.listVendors(req.query.status as ApprovalStatus | undefined));
  } catch (err) {
    next(err);
  }
};

export const approveVendorHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    ok(res, await adminService.approveVendor(req.user!.id, req.params.id));
  } catch (err) {
    next(err);
  }
};

export const suspendVendorHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    ok(res, await adminService.suspendVendor(req.user!.id, req.params.id));
  } catch (err) {
    next(err);
  }
};

export const setVendorCommissionHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    ok(res, await adminService.setVendorCommission(req.params.id, req.body.rate));
  } catch (err) {
    next(err);
  }
};

export const listRidersHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    ok(res, await adminService.listRiders(req.query.status as ApprovalStatus | undefined));
  } catch (err) {
    next(err);
  }
};

export const approveRiderHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    ok(res, await adminService.approveRider(req.user!.id, req.params.id));
  } catch (err) {
    next(err);
  }
};

export const suspendRiderHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    ok(res, await adminService.suspendRider(req.user!.id, req.params.id));
  } catch (err) {
    next(err);
  }
};

export const listAllOrdersHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    ok(
      res,
      await adminService.listAllOrders({
        status: req.query.status as OrderStatus | undefined,
        vendorId: req.query.vendorId as string | undefined,
      })
    );
  } catch (err) {
    next(err);
  }
};

export const listAllPaymentsHandler = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    ok(res, await adminService.listAllPayments());
  } catch (err) {
    next(err);
  }
};

export const getSettingsHandler = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    ok(res, await adminService.getPlatformSettings());
  } catch (err) {
    next(err);
  }
};

export const updateSettingsHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    ok(res, await adminService.updatePlatformSettings(req.body));
  } catch (err) {
    next(err);
  }
};

export const issueRefundHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    ok(res, await adminService.issueRefund(req.user!.id, req.params.id, req.body.reason ?? "Refund issued by admin"));
  } catch (err) {
    next(err);
  }
};
