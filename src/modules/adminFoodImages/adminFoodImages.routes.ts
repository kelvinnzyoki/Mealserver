import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { authorize } from "../../middleware/authorize";
import { validate } from "../../middleware/validate";
import { Role } from "@prisma/client";
import { setFoodItemImageSchema } from "./adminFoodImages.validation";
import { listFoodItemsHandler, setFoodItemImageHandler } from "./adminFoodImages.controller";

const router = Router();
router.use(requireAuth, authorize(Role.ADMIN));

router.get("/food-items", listFoodItemsHandler);
router.patch("/food-items/:id/image", validate(setFoodItemImageSchema), setFoodItemImageHandler);

export default router;
