import { Request, Response, NextFunction } from "express";
import * as paymentService from "./payment.service";
import { ok } from "../../utils/apiResponse";
import { logger } from "../../utils/logger";

export async function initiateStkPushHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const payment = await paymentService.initiatePaymentForOrder(req.user!.id, req.body.orderId, req.body.phone);
    ok(res, {
      paymentId: payment.id,
      checkoutRequestId: payment.checkoutRequestId,
      message: "Check your phone and enter your M-Pesa PIN to complete payment.",
    });
  } catch (err) {
    next(err);
  }
}

// Safaricom calls this directly — no auth header, no cookies. It must
// always return 200 quickly (Safaricom retries on non-200 / timeout), even
// if we don't recognise the payload, so failures are swallowed and logged
// rather than surfaced as HTTP errors.
export async function mpesaCallbackHandler(req: Request, res: Response) {
  try {
    await paymentService.handleMpesaCallback(req.body);
  } catch (err) {
    logger.error("Error processing M-Pesa callback", { error: err instanceof Error ? err.message : String(err) });
  }
  res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });
}

export async function getPaymentStatusHandler(req: Request, res: Response, next: NextFunction) {
  try {
    ok(res, await paymentService.getPaymentStatus(req.user!.id, req.params.orderId));
  } catch (err) {
    next(err);
  }
}
