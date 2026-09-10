import { Request, Response, NextFunction } from "express";
import { AnyZodObject, ZodError } from "zod";

// Validates req.body / req.query / req.params against a zod schema shaped
// like { body?, query?, params? }. On failure, returns a 400 with a clear
// field-level message instead of letting bad input reach a controller.
export function validate(schema: AnyZodObject) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = schema.parse({
        body: req.body,
        query: req.query,
        params: req.params,
      });
      req.body = parsed.body ?? req.body;
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: err.errors.map((e) => ({ path: e.path.join("."), message: e.message })),
        });
      }
      next(err);
    }
  };
}
