import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { authorize } from "../../middleware/authorize";
import { validate } from "../../middleware/validate";
import { authLimiter } from "../../middleware/rateLimiter";
import { Role } from "@prisma/client";
import { applyAsRiderSchema, updateRiderProfileSchema } from "./rider.validation";
import {
  applyHandler,
  getMyProfileHandler,
  updateMyProfileHandler,
  deliveryHistoryHandler,
  earningsHandler,
} from "./rider.controller";

const router = Router();
router.post("/apply", authLimiter, validate(applyAsRiderSchema), applyHandler);

router.use(requireAuth, authorize(Role.RIDER));
router.get("/me", getMyProfileHandler);
router.patch("/me", validate(updateRiderProfileSchema), updateMyProfileHandler);
router.get("/me/deliveries", deliveryHistoryHandler);
router.get("/me/earnings", earningsHandler);

export default router;
