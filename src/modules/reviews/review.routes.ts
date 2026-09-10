import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { authorize } from "../../middleware/authorize";
import { validate } from "../../middleware/validate";
import { Role } from "@prisma/client";
import { createReviewSchema } from "./review.validation";
import { createReviewHandler, listVendorReviewsHandler } from "./review.controller";

const router = Router();

router.get("/vendor/:vendorId", listVendorReviewsHandler); // public
router.post("/", requireAuth, authorize(Role.CUSTOMER), validate(createReviewSchema), createReviewHandler);

export default router;
