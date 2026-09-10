import { Request, Response, NextFunction } from "express";
import * as foodService from "./food.service";
import { ok, created } from "../../utils/apiResponse";
import { prisma } from "../../config/prisma";
import { AppError } from "../../utils/AppError";

export async function createCategoryHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const category = await foodService.createCategory(req.user!.id, req.body.name, req.body.sortOrder);
    created(res, category);
  } catch (err) {
    next(err);
  }
}

export async function updateCategoryHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const category = await foodService.updateCategory(req.user!.id, req.params.id, req.body);
    ok(res, category);
  } catch (err) {
    next(err);
  }
}

export async function deleteCategoryHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await foodService.deleteCategory(req.user!.id, req.params.id);
    ok(res, { deleted: true });
  } catch (err) {
    next(err);
  }
}

export async function listOwnCategoriesHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const vendor = await prisma.vendor.findUnique({ where: { userId: req.user!.id } });
    if (!vendor) throw AppError.notFound("Vendor profile not found");
    const categories = await foodService.listOwnCategories(vendor.id);
    ok(res, categories);
  } catch (err) {
    next(err);
  }
}

export async function createFoodItemHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const item = await foodService.createFoodItem(req.user!.id, req.body);
    created(res, item);
  } catch (err) {
    next(err);
  }
}

export async function updateFoodItemHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const item = await foodService.updateFoodItem(req.user!.id, req.params.id, req.body);
    ok(res, item);
  } catch (err) {
    next(err);
  }
}

export async function deleteFoodItemHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await foodService.deleteFoodItem(req.user!.id, req.params.id);
    ok(res, { deleted: true });
  } catch (err) {
    next(err);
  }
}

export async function listOwnFoodItemsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const items = await foodService.listOwnFoodItems(req.user!.id);
    ok(res, items);
  } catch (err) {
    next(err);
  }
}

export async function searchFoodHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const items = await foodService.searchFood({
      q: req.query.q as string | undefined,
      category: req.query.category as string | undefined,
      todaysMenu: req.query.todaysMenu === "true",
      zoneId: req.query.zoneId as string | undefined,
    });
    ok(res, items);
  } catch (err) {
    next(err);
  }
}

export async function getFoodItemDetailHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const item = await foodService.getFoodItemDetail(req.params.id);
    ok(res, item);
  } catch (err) {
    next(err);
  }
}
