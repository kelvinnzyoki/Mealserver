import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { authorize } from "../../middleware/authorize";
import { validate } from "../../middleware/validate";
import { Role } from "@prisma/client";
import { upsertZoneSchema } from "./zone.validation";
import { listZonesHandler, createZoneHandler, updateZoneHandler, deleteZoneHandler } from "./zone.controller";

const router = Router();

router.get("/", listZonesHandler); // public — frontend needs this to show "free delivery" badges
router.post("/", requireAuth, authorize(Role.ADMIN), validate(upsertZoneSchema), createZoneHandler);
router.patch("/:id", requireAuth, authorize(Role.ADMIN), updateZoneHandler);
router.delete("/:id", requireAuth, authorize(Role.ADMIN), deleteZoneHandler);

export default router;
