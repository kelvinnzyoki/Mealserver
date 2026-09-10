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

export const updateProfileSchema = z.object({
  body: z.object({
    fullName: z.string().min(2).optional(),
    email: z.string().email().optional(),
  }),
});
