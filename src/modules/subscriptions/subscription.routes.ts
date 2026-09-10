import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { authorize } from "../../middleware/authorize";
import { validate } from "../../middleware/validate";
import { Role } from "@prisma/client";
import { createMealPlanSchema } from "./subscription.validation";
import { createHandler, listMineHandler, setStatusHandler } from "./subscription.controller";

const router = Router();
router.use(requireAuth, authorize(Role.CUSTOMER));

router.post("/", validate(createMealPlanSchema), createHandler);
router.get("/mine", listMineHandler);
router.patch("/:id/status", setStatusHandler);

export default router;
