import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { authorize } from "../../middleware/authorize";
import { validate } from "../../middleware/validate";
import { authLimiter } from "../../middleware/rateLimiter";
import { applyAsVendorSchema, updateVendorProfileSchema } from "./vendor.validation";
import {
  applyHandler,
  listPublicVendorsHandler,
  getVendorPublicProfileHandler,
  getMyVendorProfileHandler,
  updateMyProfileHandler,
  earningsHandler,
} from "./vendor.controller";
import { Role } from "@prisma/client";

const router = Router();

router.post("/apply", authLimiter, validate(applyAsVendorSchema), applyHandler);
router.get("/", listPublicVendorsHandler);
router.get("/me", requireAuth, authorize(Role.VENDOR), getMyVendorProfileHandler);
router.patch("/me", requireAuth, authorize(Role.VENDOR), validate(updateVendorProfileSchema), updateMyProfileHandler);
router.get("/me/earnings", requireAuth, authorize(Role.VENDOR), earningsHandler);
router.get("/:id", getVendorPublicProfileHandler);

export default router;
