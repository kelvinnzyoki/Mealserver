import { z } from "zod";

// Kenyan MSISDN normalised to 2547XXXXXXXX / 2541XXXXXXXX format.
const phoneSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/\s+/g, ""))
  .refine((v) => /^(?:\+?254|0)(7|1)\d{8}$/.test(v), {
    message: "Enter a valid Kenyan phone number, e.g. 0712345678",
  });

export const startRegistrationSchema = z.object({
  body: z.object({
    fullName: z.string().trim().min(2, "Full name is too short").max(100, "Full name is too long"),
    phone: phoneSchema,
    email: z.string().trim().max(254).email("Enter a valid email address"),
    password: z.string().min(8, "Password must be at least 8 characters").max(128, "Password is too long"),
  }),
});

export const verifyRegistrationSchema = z.object({
  body: z.object({
    email: z.string().trim().max(254).email(),
    code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code"),
  }),
});

export const resendRegistrationCodeSchema = z.object({
  body: z.object({
    email: z.string().trim().max(254).email(),
  }),
});

// Login accepts either a phone number or an email address in the same
// field — auth.service.ts decides which one it is by checking for "@".
export const loginSchema = z.object({
  body: z.object({
    identifier: z.string().trim().min(3, "Enter your phone number or email").max(254),
    password: z.string().min(1, "Password is required").max(128),
  }),
});

// Password reset request — now by EMAIL (via Resend), since there's no
// approved Africa's Talking sender ID for SMS yet. Switch back to
// phoneSchema below once that's sorted; auth.service.ts/auth.controller.ts
// have the matching commented-out phone path ready to re-enable alongside
// this.
export const requestPasswordResetSchema = z.object({
  body: z.object({
    email: z.string().trim().max(254).email("Enter a valid email address"),
  }),
});

// ---- Previous phone-based version — kept for when the SMS sender ID is approved ----
// export const requestPasswordResetSchema = z.object({
//   body: z.object({
//     phone: phoneSchema,
//   }),
// });

export const resetPasswordSchema = z.object({
  body: z.object({
    token: z.string().min(10).max(200),
    newPassword: z.string().min(8, "Password must be at least 8 characters").max(128, "Password is too long"),
  }),
});

export function normalizeKenyanPhone(raw: string): string {
  const digits = raw.replace(/\s+/g, "");
  if (digits.startsWith("+254")) return digits.slice(1);
  if (digits.startsWith("254")) return digits;
  if (digits.startsWith("0")) return `254${digits.slice(1)}`;
  return digits;
}
