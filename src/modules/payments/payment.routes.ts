import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { authorize } from "../../middleware/authorize";
import { validate } from "../../middleware/validate";
import { stkPushLimiter } from "../../middleware/rateLimiter";
import { Role } from "@prisma/client";
import { initiateStkPushSchema } from "./payment.validation";
import { initiateStkPushHandler, mpesaCallbackHandler, getPaymentStatusHandler } from "./payment.controller";

const router = Router();

// Public — Safaricom's servers hit this, so it must not require our cookies
// or JWT. Protect it instead by (a) keeping the callback URL unguessable in
// deployments where that matters, and (b) the checkoutRequestId lookup in
// the service, which means a forged callback for an unknown/foreign
// CheckoutRequestID is a harmless no-op.
router.post("/mpesa/callback", mpesaCallbackHandler);

router.post(
  "/mpesa/stk-push",
  requireAuth,
  authorize(Role.CUSTOMER),
  stkPushLimiter,
  validate(initiateStkPushSchema),
  initiateStkPushHandler
);
router.get("/mpesa/status/:orderId", requireAuth, authorize(Role.CUSTOMER), getPaymentStatusHandler);

export default router;
