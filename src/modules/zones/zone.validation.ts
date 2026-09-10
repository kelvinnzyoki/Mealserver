import { z } from "zod";

export const upsertZoneSchema = z.object({
  body: z.object({
    name: z.string().min(2),
    isFreeDelivery: z.boolean().default(false),
    deliveryFee: z.number().min(0).default(0),
    minOrderValue: z.number().min(0).default(0),
    centerLat: z.number().optional(),
    centerLng: z.number().optional(),
    radiusKm: z.number().positive().optional(),
    isActive: z.boolean().optional(),
  }),
});
