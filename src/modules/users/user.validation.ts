import { z } from "zod";

export const upsertAddressSchema = z.object({
  body: z.object({
    label: z.string().min(1),
    building: z.string().optional(),
    street: z.string().optional(),
    area: z.string().optional(),
    city: z.string().optional(),
    landmark: z.string().optional(),
    latitude: z.number(),
    longitude: z.number(),
    contactPhone: z.string().optional(),
    contactName: z.string().optional(),
    isDefault: z.boolean().optional(),
  }),
});

// Same fields as create, all optional. Previously PATCH /me/addresses/:id had
// no schema at all, so the raw request body went straight into prisma.update.
export const updateAddressSchema = z.object({
  body: upsertAddressSchema.shape.body.partial(),
});

// Name only. Email used to be editable here with no proof of ownership; it now
// goes through the two-step /me/email/start + /me/email/verify flow instead.
export const updateProfileSchema = z.object({
  body: z.object({
    fullName: z.string().trim().min(2, "Full name is too short").max(80, "Full name is too long"),
  }),
});

export const changePasswordSchema = z.object({
  body: z.object({
    currentPassword: z.string().min(1, "Enter your current password"),
    newPassword: z.string().min(8, "Password must be at least 8 characters"),
  }),
});

export const startEmailChangeSchema = z.object({
  body: z.object({
    newEmail: z.string().trim().email("Enter a valid email address"),
    password: z.string().min(1, "Enter your password to confirm"),
  }),
});

export const verifyEmailChangeSchema = z.object({
  body: z.object({
    code: z.string().trim().length(6, "Enter the 6-digit code"),
  }),
});

export const deleteAccountSchema = z.object({
  body: z.object({
    password: z.string().min(1, "Enter your password to confirm"),
  }),
});
