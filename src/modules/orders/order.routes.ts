import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { authorize } from "../../middleware/authorize";
import { validate } from "../../middleware/validate";
import { Role } from "@prisma/client";
import { checkoutSchema, updateOrderStatusSchema, cancelOrderSchema } from "./order.validation";
import {
  checkoutHandler,
  getMyOrdersHandler,
  getOrderDetailHandler,
  vendorUpdateStatusHandler,
  cancelOrderHandler,
  reorderHandler,
  getVendorOrdersHandler,
} from "./order.controller";

const router = Router();
router.use(requireAuth);

router.post("/checkout", authorize(Role.CUSTOMER), validate(checkoutSchema), checkoutHandler);
router.get("/mine", authorize(Role.CUSTOMER), getMyOrdersHandler);
router.post("/:id/cancel", authorize(Role.CUSTOMER), validate(cancelOrderSchema), cancelOrderHandler);
router.post("/:id/reorder", authorize(Role.CUSTOMER), reorderHandler);

router.get("/vendor/mine", authorize(Role.VENDOR), getVendorOrdersHandler);
router.patch("/:id/status", authorize(Role.VENDOR), validate(updateOrderStatusSchema), vendorUpdateStatusHandler);

// Shared detail route — access control (owner / vendor / rider / admin) is
// enforced inside the service, since different roles can each legitimately
// view one order.
router.get("/:id", getOrderDetailHandler);

export default router;
