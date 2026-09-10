import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { authorize } from "../../middleware/authorize";
import { Role } from "@prisma/client";
import {
  listAvailableHandler,
  acceptHandler,
  pickedUpHandler,
  deliveredHandler,
  failedHandler,
} from "./delivery.controller";

const router = Router();
router.use(requireAuth, authorize(Role.RIDER));

router.get("/available", listAvailableHandler);
router.post("/:orderId/accept", acceptHandler);
router.patch("/:orderId/picked-up", pickedUpHandler);
router.patch("/:orderId/delivered", deliveredHandler);
router.patch("/:orderId/failed", failedHandler);

export default router;
