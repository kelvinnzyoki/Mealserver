import { z } from "zod";

// Safaricom M-Pesa numbers only: 07XXXXXXXX, 01XXXXXXXX, 7XXXXXXXX, 1XXXXXXXX,
// 2547XXXXXXXX, 2541XXXXXXXX or +254… (spaces and dashes are tolerated).
// Live STK pushes go to real phones, so a malformed number is rejected up
// front instead of being sent to Daraja.
const kenyanMsisdn = /^(?:\+?254|0)?[17]\d{8}$/;

export const initiateStkPushSchema = z.object({
  body: z.object({
    orderId: z.string(),
    phone: z
      .string()
      .refine((v) => kenyanMsisdn.test(v.replace(/[\s-]/g, "")), {
        message: "Enter a valid Safaricom number, e.g. 0712345678",
      }),
  }),
});
