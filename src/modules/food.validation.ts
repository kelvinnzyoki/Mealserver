import { z } from "zod";

export const createCategorySchema = z.object({
  body: z.object({
    name: z.string().min(1),
    sortOrder: z.number().int().optional(),
  }),
});

const variationInput = z.object({
  name: z.string().min(1),
  priceDelta: z.number().default(0),
  isRequired: z.boolean().default(false),
  groupName: z.string().default("Options"),
});

export const createFoodItemSchema = z.object({
  body: z.object({
    categoryId: z.string(),
    name: z.string().min(1),
    description: z.string().optional(),
    imageUrl: z.string().url().optional(),
    basePrice: z.number().positive(),
    isTodaysMenu: z.boolean().optional(),
    prepTimeMins: z.number().int().positive().optional(),
    calorieInfo: z.string().optional(),
    variations: z.array(variationInput).optional(),
  }),
});

export const updateFoodItemSchema = z.object({
  body: z.object({
    categoryId: z.string().optional(),
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    imageUrl: z.string().url().optional(),
    basePrice: z.number().positive().optional(),
    isAvailable: z.boolean().optional(),
    isTodaysMenu: z.boolean().optional(),
    prepTimeMins: z.number().int().positive().optional(),
    calorieInfo: z.string().optional(),
  }),
});
