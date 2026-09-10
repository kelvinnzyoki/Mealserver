import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { addToCartSchema, updateCartItemSchema } from "./cart.validation";
import { getCartHandler, addItemHandler, updateItemHandler, removeItemHandler, clearCartHandler } from "./cart.controller";
import { Role } from "@prisma/client";
import { authorize } from "../../middleware/authorize";

const router = Router();
router.use(requireAuth, authorize(Role.CUSTOMER));

router.get("/", getCartHandler);
router.post("/items", validate(addToCartSchema), addItemHandler);
router.patch("/items/:itemId", validate(updateCartItemSchema), updateItemHandler);
router.delete("/items/:itemId", removeItemHandler);
router.delete("/", clearCartHandler);

export default router;
