import { z } from "zod";

// scheduledFor must be a sensible near-future time (small grace for clock skew).
const scheduledFor = z
  .string()
  .datetime()
  .refine(
    (v) => {
      const t = Date.parse(v);
      return t > Date.now() - 5 * 60_000 && t < Date.now() + 30 * 24 * 60 * 60_000;
    },
    { message: "Choose a delivery time within the next 30 days" }
  );

export const checkoutSchema = z.object({
  body: z.object({
    addressId: z.string().max(100),
    specialInstructions: z.string().max(300).optional(),
    couponCode: z.string().trim().max(40).optional(),
    recipientName: z.string().trim().max(100).optional(),
    recipientPhone: z.string().trim().max(20).optional(),
    scheduledFor: scheduledFor.optional(),
  }),
});

export const updateOrderStatusSchema = z.object({
  body: z.object({
    status: z.enum(["ACCEPTED", "REJECTED", "PREPARING", "READY_FOR_PICKUP"]),
    reason: z.string().max(300).optional(),
  }),
});

export const cancelOrderSchema = z.object({
  body: z.object({
    reason: z.string().max(300).optional(),
  }),
});
