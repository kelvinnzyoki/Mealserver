import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { authLimiter } from "../../middleware/rateLimiter";
import {
  upsertAddressSchema,
  updateAddressSchema,
  updateProfileSchema,
  changePasswordSchema,
  startEmailChangeSchema,
  verifyEmailChangeSchema,
  deleteAccountSchema,
} from "./user.validation";
import {
  listAddressesHandler,
  createAddressHandler,
  updateAddressHandler,
  deleteAddressHandler,
  updateProfileHandler,
  changePasswordHandler,
  revokeOtherSessionsHandler,
  startEmailChangeHandler,
  verifyEmailChangeHandler,
  deleteAccountHandler,
} from "./user.controller";

const router = Router();
router.use(requireAuth);

router.patch("/me", validate(updateProfileSchema), updateProfileHandler);

// Anything that re-checks the password goes through authLimiter so it can't
// be used to guess the current password from a stolen session.
router.patch("/me/password", authLimiter, validate(changePasswordSchema), changePasswordHandler);
router.post("/me/sessions/revoke-others", revokeOtherSessionsHandler);
router.post("/me/email/start", authLimiter, validate(startEmailChangeSchema), startEmailChangeHandler);
router.post("/me/email/verify", authLimiter, validate(verifyEmailChangeSchema), verifyEmailChangeHandler);
// POST rather than DELETE because it carries the password in the body, and
// the frontend's api.delete() doesn't send one.
router.post("/me/delete", authLimiter, validate(deleteAccountSchema), deleteAccountHandler);

router.get("/me/addresses", listAddressesHandler);
router.post("/me/addresses", validate(upsertAddressSchema), createAddressHandler);
router.patch("/me/addresses/:id", validate(updateAddressSchema), updateAddressHandler);
router.delete("/me/addresses/:id", deleteAddressHandler);

export default router;
