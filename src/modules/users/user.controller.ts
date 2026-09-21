import { Request, Response, NextFunction } from "express";
import * as userService from "./user.service";
import { ok, created } from "../../utils/apiResponse";
import { clearAuthCookies } from "../../utils/cookies";

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

export async function changePasswordHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await userService.changePassword(
      req.user!.id,
      req.body.currentPassword,
      req.body.newPassword,
      req.cookies?.kg_refresh
    );
    ok(res, { message: "Password updated. Your other devices have been signed out." });
  } catch (err) {
    next(err);
  }
}

export async function revokeOtherSessionsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await userService.revokeOtherSessions(req.user!.id, req.cookies?.kg_refresh);
    ok(res, { message: "Signed out of all other devices." });
  } catch (err) {
    next(err);
  }
}

export async function startEmailChangeHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await userService.startEmailChange(req.user!.id, req.body.newEmail, req.body.password);
    ok(res, { message: "We've emailed you a 6-digit code. Enter it to confirm your new address." });
  } catch (err) {
    next(err);
  }
}

export async function verifyEmailChangeHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await userService.verifyEmailChange(req.user!.id, req.body.code);
    ok(res, { id: user.id, fullName: user.fullName, email: user.email, phone: user.phone });
  } catch (err) {
    next(err);
  }
}

export async function deleteAccountHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await userService.deleteAccount(req.user!.id, req.body.password);
    clearAuthCookies(res);
    ok(res, { deleted: true });
  } catch (err) {
    next(err);
  }
}
