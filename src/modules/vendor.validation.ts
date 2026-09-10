import { z } from "zod";

export const applyAsVendorSchema = z.object({
  body: z.object({
    fullName: z.string().min(2),
    phone: z.string().min(9),
    email: z.string().email().optional(),
    password: z.string().min(8),
    businessName: z.string().min(2),
    description: z.string().optional(),
    physicalAddress: z.string().optional(),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
  }),
});

export const updateVendorProfileSchema = z.object({
  body: z.object({
    businessName: z.string().min(2).optional(),
    description: z.string().optional(),
    logoUrl: z.string().url().optional(),
    coverImageUrl: z.string().url().optional(),
    isOpen: z.boolean().optional(),
    avgPrepTimeMins: z.number().int().positive().optional(),
    physicalAddress: z.string().optional(),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
  }),
});
