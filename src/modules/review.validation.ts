import { z } from "zod";

export const createReviewSchema = z.object({
  body: z.object({
    orderId: z.string(),
    rating: z.number().int().min(1).max(5),
    comment: z.string().max(500).optional(),
    foodItemId: z.string().optional(),
  }),
});
