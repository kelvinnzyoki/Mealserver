import { Router } from "express";
import { validate } from "../../middleware/validate";
import { requireAuth } from "../../middleware/auth";
import { authLimiter } from "../../middleware/rateLimiter";
import {
  startRegistrationSchema,
  verifyRegistrationSchema,
  resendRegistrationCodeSchema,
  loginSchema,
  requestPasswordResetSchema,
  resetPasswordSchema,
} from "./auth.validation";
import {
  startRegistrationHandler,
  verifyRegistrationHandler,
  resendRegistrationCodeHandler,
  loginHandler,
  refreshHandler,
  logoutHandler,
  meHandler,
  requestPasswordResetHandler,
  resetPasswordHandler,
} from "./auth.controller";

const router = Router();

// Two-step signup: /register/start emails a 6-digit code and creates
// nothing yet; /register/verify checks it and actually creates the account.
router.post("/register/start", authLimiter, validate(startRegistrationSchema), startRegistrationHandler);
router.post("/register/verify", authLimiter, validate(verifyRegistrationSchema), verifyRegistrationHandler);
router.post("/register/resend", authLimiter, validate(resendRegistrationCodeSchema), resendRegistrationCodeHandler);

router.post("/login", authLimiter, validate(loginSchema), loginHandler);
router.post("/refresh", refreshHandler);
router.post("/logout", logoutHandler);
router.get("/me", requireAuth, meHandler);
router.post(
  "/password-reset/request",
  authLimiter,
  validate(requestPasswordResetSchema),
  requestPasswordResetHandler
);
router.post("/password-reset/confirm", authLimiter, validate(resetPasswordSchema), resetPasswordHandler);

export default router;
