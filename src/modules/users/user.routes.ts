import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { upsertAddressSchema, updateProfileSchema } from "./user.validation";
import {
  listAddressesHandler,
  createAddressHandler,
  updateAddressHandler,
  deleteAddressHandler,
  updateProfileHandler,
} from "./user.controller";

const router = Router();
router.use(requireAuth);

router.patch("/me", validate(updateProfileSchema), updateProfileHandler);
router.get("/me/addresses", listAddressesHandler);
router.post("/me/addresses", validate(upsertAddressSchema), createAddressHandler);
router.patch("/me/addresses/:id", updateAddressHandler);
router.delete("/me/addresses/:id", deleteAddressHandler);

export default router;
