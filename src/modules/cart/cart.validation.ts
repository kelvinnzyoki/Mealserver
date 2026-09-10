import { z } from "zod";

export const addToCartSchema = z.object({
  body: z.object({
    foodItemId: z.string(),
    quantity: z.number().int().positive().default(1),
    notes: z.string().optional(),
    variationIds: z.array(z.string()).optional(),
  }),
});

export const updateCartItemSchema = z.object({
  body: z.object({
    quantity: z.number().int().positive(),
  }),
});
