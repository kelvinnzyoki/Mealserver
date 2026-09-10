import { z } from "zod";

export const applyAsRiderSchema = z.object({
  body: z.object({
    fullName: z.string().min(2),
    phone: z.string().min(9),
    email: z.string().email().optional(),
    password: z.string().min(8),
    vehicleType: z.string().optional(),
    numberPlate: z.string().optional(),
    nationalIdNo: z.string().optional(),
  }),
});

export const updateRiderProfileSchema = z.object({
  body: z.object({
    isAvailable: z.boolean().optional(),
    vehicleType: z.string().optional(),
    numberPlate: z.string().optional(),
    currentLat: z.number().optional(),
    currentLng: z.number().optional(),
  }),
});
