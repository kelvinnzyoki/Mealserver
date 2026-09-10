import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { authorize } from "../../middleware/authorize";
import { Role } from "@prisma/client";
import {
  dashboardHandler,
  listVendorsHandler,
  approveVendorHandler,
  suspendVendorHandler,
  setVendorCommissionHandler,
  listRidersHandler,
  approveRiderHandler,
  suspendRiderHandler,
  listAllOrdersHandler,
  listAllPaymentsHandler,
  getSettingsHandler,
  updateSettingsHandler,
  issueRefundHandler,
} from "./admin.controller";

const router = Router();
router.use(requireAuth, authorize(Role.ADMIN));

router.get("/dashboard", dashboardHandler);

router.get("/vendors", listVendorsHandler);
router.post("/vendors/:id/approve", approveVendorHandler);
router.post("/vendors/:id/suspend", suspendVendorHandler);
router.patch("/vendors/:id/commission", setVendorCommissionHandler);

router.get("/riders", listRidersHandler);
router.post("/riders/:id/approve", approveRiderHandler);
router.post("/riders/:id/suspend", suspendRiderHandler);

router.get("/orders", listAllOrdersHandler);
router.post("/orders/:id/refund", issueRefundHandler);

router.get("/payments", listAllPaymentsHandler);

router.get("/settings", getSettingsHandler);
router.patch("/settings", updateSettingsHandler);

export default router;
