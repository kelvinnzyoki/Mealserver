import { Router, Request } from "express";
import { AppError } from "../../utils/AppError";
import { env } from "../../config/env";
import { expireStaleOrders } from "../../jobs/expireStaleOrders";
import { generateDueMealPlanOrders } from "../../jobs/generateMealPlanOrders";
import { ok } from "../../utils/apiResponse";

const router = Router();

// Guarded by a shared secret rather than user auth, since the caller is a
// scheduler, not a signed-in person. Accepts either:
//  - `Authorization: Bearer <secret>` — what Vercel Cron sends automatically
//    when you set a CRON_SECRET environment variable (no extra config
//    needed on the cron job itself, see vercel.json "crons").
//  - `x-internal-secret: <secret>` — for other schedulers (GitHub Actions,
//    cron-job.org, etc.) that can set arbitrary headers.
// Vercel Cron only ever sends GET requests, so these routes are GET too.
function requireInternalSecret(req: Request) {
  const bearer = req.header("authorization")?.replace(/^Bearer\s+/i, "");
  const provided = req.header("x-internal-secret") ?? bearer;
  if (!env.internalJobSecret || provided !== env.internalJobSecret) {
    throw AppError.unauthorized("Invalid internal job secret");
  }
}

router.get("/jobs/expire-stale-orders", async (req, res, next) => {
  try {
    requireInternalSecret(req);
    ok(res, await expireStaleOrders());
  } catch (err) {
    next(err);
  }
});

router.get("/jobs/generate-meal-plan-orders", async (req, res, next) => {
  try {
    requireInternalSecret(req);
    ok(res, await generateDueMealPlanOrders());
  } catch (err) {
    next(err);
  }
});

export default router;
