import { z } from "zod";

export const createMealPlanSchema = z.object({
  body: z.object({
    vendorId: z.string(),
    frequency: z.enum(["DAILY", "WEEKDAYS", "WEEKLY"]),
    deliveryTime: z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM, e.g. 13:00"),
    addressId: z.string(),
    startDate: z.string().datetime(),
    endDate: z.string().datetime().optional(),
  }),
});
