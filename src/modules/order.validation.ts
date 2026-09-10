import { z } from "zod";

export const checkoutSchema = z.object({
  body: z.object({
    addressId: z.string(),
    specialInstructions: z.string().max(300).optional(),
    couponCode: z.string().optional(),
    recipientName: z.string().optional(),
    recipientPhone: z.string().optional(),
    scheduledFor: z.string().datetime().optional(),
  }),
});

export const updateOrderStatusSchema = z.object({
  body: z.object({
    status: z.enum(["ACCEPTED", "REJECTED", "PREPARING", "READY_FOR_PICKUP"]),
    reason: z.string().optional(),
  }),
});

export const cancelOrderSchema = z.object({
  body: z.object({
    reason: z.string().optional(),
  }),
});
