import { z } from "zod";

// Constrained to the preset-gallery path prefix rather than any string —
// this endpoint is "assign from the gallery", not a general-purpose image
// URL field, so this blocks an arbitrary external URL from being slipped
// in even though the caller is already admin-only.
const presetImagePath = z
  .string()
  .trim()
  .refine((v) => v.startsWith("/images/food/"), {
    message: "Choose an image from the preset gallery",
  });

export const setFoodItemImageSchema = z.object({
  body: z.object({
    imageUrl: presetImagePath.nullable(),
  }),
});
