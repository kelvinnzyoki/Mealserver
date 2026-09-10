import { z } from "zod";

export const createCouponSchema = z.object({
  body: z.object({
    code: z.string().min(3).toUpperCase(),
    discountType: z.enum(["PERCENTAGE", "FIXED_AMOUNT"]),
    discountValue: z.number().positive(),
    minOrderValue: z.number().min(0).default(0),
    maxUses: z.number().int().positive().optional(),
    startsAt: z.string().datetime().optional(),
    expiresAt: z.string().datetime().optional(),
    vendorOnly: z.boolean().optional(), // if true, scopes to the creating vendor
  }),
});
