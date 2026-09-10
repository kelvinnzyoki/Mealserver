import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { authorize } from "../../middleware/authorize";
import { validate } from "../../middleware/validate";
import { Role } from "@prisma/client";
import { createCategorySchema, createFoodItemSchema, updateFoodItemSchema } from "./food.validation";
import {
  createCategoryHandler,
  updateCategoryHandler,
  deleteCategoryHandler,
  listOwnCategoriesHandler,
  createFoodItemHandler,
  updateFoodItemHandler,
  deleteFoodItemHandler,
  listOwnFoodItemsHandler,
  searchFoodHandler,
  getFoodItemDetailHandler,
} from "./food.controller";

const router = Router();
const vendorOnly = [requireAuth, authorize(Role.VENDOR)];

// Public
router.get("/search", searchFoodHandler);
router.get("/items/:id", getFoodItemDetailHandler);

// Vendor menu management
router.get("/categories/mine", ...vendorOnly, listOwnCategoriesHandler);
router.post("/categories", ...vendorOnly, validate(createCategorySchema), createCategoryHandler);
router.patch("/categories/:id", ...vendorOnly, updateCategoryHandler);
router.delete("/categories/:id", ...vendorOnly, deleteCategoryHandler);

router.get("/items/mine/all", ...vendorOnly, listOwnFoodItemsHandler);
router.post("/items", ...vendorOnly, validate(createFoodItemSchema), createFoodItemHandler);
router.patch("/items/:id", ...vendorOnly, validate(updateFoodItemSchema), updateFoodItemHandler);
router.delete("/items/:id", ...vendorOnly, deleteFoodItemHandler);

export default router;
