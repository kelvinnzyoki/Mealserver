import { z } from "zod";

export const initiateStkPushSchema = z.object({
  body: z.object({
    orderId: z.string(),
    phone: z.string().min(9),
  }),
});
