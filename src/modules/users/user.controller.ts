import { Request, Response, NextFunction } from "express";
import * as userService from "./user.service";
import { ok, created } from "../../utils/apiResponse";

export async function listAddressesHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const addresses = await userService.listAddresses(req.user!.id);
    ok(res, addresses);
  } catch (err) {
    next(err);
  }
}

export async function createAddressHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const address = await userService.createAddress(req.user!.id, req.body);
    created(res, address);
  } catch (err) {
    next(err);
  }
}

export async function updateAddressHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const address = await userService.updateAddress(req.user!.id, req.params.id, req.body);
    ok(res, address);
  } catch (err) {
    next(err);
  }
}

export async function deleteAddressHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await userService.deleteAddress(req.user!.id, req.params.id);
    ok(res, { deleted: true });
  } catch (err) {
    next(err);
  }
}

export async function updateProfileHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await userService.updateProfile(req.user!.id, req.body);
    ok(res, { id: user.id, fullName: user.fullName, email: user.email, phone: user.phone });
  } catch (err) {
    next(err);
  }
}
