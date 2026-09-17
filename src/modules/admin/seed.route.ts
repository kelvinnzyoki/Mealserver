import { Router, Request, Response } from "express";
import { seedDatabase } from "../../../prisma/seed";

const router = Router();

// GET so you can trigger it by just visiting the URL from your phone's browser.
// Protected by a secret query param so randoms can't wipe/reseed your DB.
router.get("/seed", async (req: Request, res: Response) => {
  const provided = req.query.secret;
  const expected = process.env.SEED_SECRET;

  if (!expected) {
    return res.status(500).json({ ok: false, error: "SEED_SECRET is not set on the server" });
  }
  if (provided !== expected) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  try {
    const summary = await seedDatabase();
    return res.status(200).json({ ok: true, summary });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ ok: false, error: err?.message ?? "Seed failed" });
  }
});

export default router;
