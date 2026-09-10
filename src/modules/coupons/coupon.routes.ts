import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { authorize } from "../../middleware/authorize";
import { validate } from "../../middleware/validate";
import { Role } from "@prisma/client";
import { createCouponSchema } from "./coupon.validation";
import { createCouponHandler, listMyCouponsHandler, setCouponActiveHandler, previewCouponHandler } from "./coupon.controller";

const router = Router();

router.post("/preview", previewCouponHandler); // public — used at cart/checkout screen

router.use(requireAuth, authorize(Role.VENDOR, Role.ADMIN));
router.post("/", validate(createCouponSchema), createCouponHandler);
router.get("/mine", listMyCouponsHandler);
router.patch("/:id/active", setCouponActiveHandler);

export default router;
