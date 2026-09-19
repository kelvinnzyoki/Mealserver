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
    fullName: z.string().trim().min(2, "Full name is too short"),
    phone: phoneSchema,
    email: z.string().trim().email("Enter a valid email address"),
    password: z.string().min(8, "Password must be at least 8 characters"),
  }),
});

export const verifyRegistrationSchema = z.object({
  body: z.object({
    email: z.string().trim().email(),
    code: z.string().trim().length(6, "Enter the 6-digit code"),
  }),
});

export const resendRegistrationCodeSchema = z.object({
  body: z.object({
    email: z.string().trim().email(),
  }),
});

export const loginSchema = z.object({
  body: z.object({
    phone: phoneSchema,
    password: z.string().min(1, "Password is required"),
  }),
});

export const requestPasswordResetSchema = z.object({
  body: z.object({
    phone: phoneSchema,
  }),
});

export const resetPasswordSchema = z.object({
  body: z.object({
    token: z.string().min(10),
    newPassword: z.string().min(8, "Password must be at least 8 characters"),
  }),
});

export function normalizeKenyanPhone(raw: string): string {
  const digits = raw.replace(/\s+/g, "");
  if (digits.startsWith("+254")) return digits.slice(1);
  if (digits.startsWith("254")) return digits;
  if (digits.startsWith("0")) return `254${digits.slice(1)}`;
  return digits;
}
