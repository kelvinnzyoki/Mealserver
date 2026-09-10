import { Router } from "express";
import { validate } from "../../middleware/validate";
import { requireAuth } from "../../middleware/auth";
import { authLimiter } from "../../middleware/rateLimiter";
import {
  registerSchema,
  loginSchema,
  requestPasswordResetSchema,
  resetPasswordSchema,
} from "./auth.validation";
import {
  registerHandler,
  loginHandler,
  refreshHandler,
  logoutHandler,
  meHandler,
  requestPasswordResetHandler,
  resetPasswordHandler,
} from "./auth.controller";

const router = Router();

router.post("/register", authLimiter, validate(registerSchema), registerHandler);
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
