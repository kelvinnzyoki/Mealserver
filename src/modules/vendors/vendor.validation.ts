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
    // Which admin-defined delivery zone this kitchen belongs to — this is
    // what actually drives the "Free delivery" badge shown on the public
    // listing for this vendor. The zone's own fee/free-delivery/min-order
    // rules are admin-only (Admin Dashboard -> Zones); a vendor can only
    // pick from zones that already exist, not define new ones.
    deliveryZoneId: z.string().min(1).optional(),
  }),
});
