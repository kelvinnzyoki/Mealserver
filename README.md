# KulaGo — Kenyan food delivery platform

Order home-cooked Kenyan food from local kitchens, pay with M-Pesa, and track
delivery from kitchen to door. Built with Next.js + Express + Prisma +
PostgreSQL, with real Safaricom Daraja (M-Pesa) integration.

**"KulaGo" is a placeholder name** ("kula" = Swahili for "eat"). It's used in
package names, page titles, and SMS copy — rename it with a project-wide
find-and-replace whenever you land on a real brand name; nothing else
depends on it.

## Repo layout

```
backend/     Express + TypeScript API, Prisma schema, M-Pesa integration
frontend/    Next.js + TypeScript + Tailwind customer/vendor/rider/admin app
```

Each is deployed independently (this mirrors how your other two projects are
already set up: Next.js/Express on Vercel, Prisma on Neon).

---

## What's implemented vs. simplified

This is a large spec, so here's an honest accounting rather than a blanket
"done" — everything below runs, but a few pieces are intentionally
simplified with a comment in the code marking the tradeoff and what a fuller
version would need.

**Fully implemented**
- Customer: register/login/reset (JWT + httpOnly rotating refresh tokens),
  browse by category/search/today's menu, food customization (variations),
  single-vendor cart, saved addresses, checkout, real M-Pesa STK Push
  (sandbox or production via env vars), order tracking, order history +
  reorder, ratings/reviews, "order for someone else."
- Vendor: application/approval flow, menu + category CRUD, availability and
  "today's menu" toggles, accept/reject/status pipeline, earnings ledger.
- Rider: application/approval flow, available-deliveries feed, accept →
  picked up → delivered flow, earnings.
- Admin: dashboard stats, vendor/rider approve & suspend, delivery zone CRUD
  (free-delivery zones, fees, minimum order), platform default settings,
  order/payment oversight, refund *recording* (see below).
- Business logic: subtotal/discount/delivery-fee/commission/total
  calculation, minimum order enforcement, closed-vendor and
  unavailable-item blocking, idempotent M-Pesa callback handling, amount
  verification against the callback, stale `PENDING_PAYMENT` order expiry
  job.

**Simplified — flagged in code comments where relevant**
- **Refunds**: rejecting a paid order or issuing an admin refund cancels the
  order and logs the decision, but doesn't move real money back — that
  needs Safaricom's B2C reversal API, which requires its own initiator
  credential and security-credential encryption setup (different from the
  STK/C2B flow used for collection here). Treat the admin "refund" action as
  a queue for someone to action manually via the Safaricom portal until
  you wire up B2C.
- **Recurring office lunch plans**: the data model, CRUD, and a daily
  "what's due today" job all exist, but it stops short of auto-charging —
  Daraja's STK Push needs the customer to approve a phone prompt each time,
  so there's no clean way to silently bill a saved plan. The job is the
  extension point; see the comment in
  `backend/src/jobs/generateMealPlanOrders.ts` for the three realistic ways
  to finish it (daily reminder + approval, a KulaGo wallet balance, or
  Safaricom's Paybill standing-order product).
- **Multi-order delivery batching**: available orders going to the same
  building/area are grouped and a rider can accept them together, but this
  is a same-address heuristic, not real route optimization (no
  travelling-salesman solve, no multi-vendor pickup sequencing).
- **Delivery zones are circles**, not polygons (center point + radius) —
  simplest thing that works for a city-level MVP; swap for a geofence
  table if zone shapes need to be irregular.
- **SMS** goes out over Africa's Talking (same provider as ClasicCloset) —
  make sure your sender ID is actually approved before relying on it in
  production, since an unregistered sender ID fails silently on some
  accounts. **Email and push notification channels are modeled in the
  schema but not wired to a live provider** — the `notification.service.ts`
  dispatch point is where you'd add SMTP/FCM.
- **No image upload** — `imageUrl` fields expect a URL you host elsewhere
  (S3, Cloudinary, etc.); there's no upload endpoint in this build.
- **Maps**: address capture uses the browser's geolocation API plus free-text
  fields (building/area/landmark) rather than a Google Maps/Mapbox
  autocomplete picker — the schema and address model are ready for one, but
  wiring an actual Places Autocomplete component is left to you (needs a
  billed Google/Mapbox API key).

---

## Prerequisites

- A [Neon](https://neon.tech) Postgres database (free tier is fine to start)
- A [Vercel](https://vercel.com) account for both frontend and backend
- A [Safaricom Daraja](https://developer.safaricom.co.ke) account for M-Pesa
  sandbox (and later, production) credentials
- An [Africa's Talking](https://africastalking.com) account if you want SMS
  notifications live (optional — the app runs fine without it, SMS calls
  just log a warning and no-op)

You mentioned you work from your phone via GitHub's web interface with no
local terminal — everything below is written for that. The one place a
terminal genuinely helps (applying the Prisma schema to a fresh database,
and running the seed script) can be done with **zero local install** using a
free browser-based terminal: [GitHub Codespaces](https://github.com/features/codespaces)
(click "Code → Codespaces → Create codespace" on your repo) or
[Replit](https://replit.com) both give you a real terminal against your repo
from any browser, phone included.

## 1. Set up the database

1. Create a Neon project and copy its connection string
   (`postgresql://...`).
2. Open a Codespace (or Replit) on your repo, `cd backend`, add a `.env`
   file with at least `DATABASE_URL=<your Neon connection string>`, then
   run:
   ```
   npm install
   npx prisma db push
   npm run seed
   ```
   `db push` creates all the tables from `prisma/schema.prisma` directly —
   no migration files needed to get started. The seed script creates two
   sample kitchens with realistic Kenyan menu items, a rider, a customer,
   an admin, and three Nairobi delivery zones. Test accounts are printed at
   the end of the seed script (also listed at the bottom of this README).
3. Once you're iterating on the schema over time, `npx prisma migrate dev`
   (also from a Codespace) will generate proper migration files you can
   commit — worth switching to once the schema stabilizes.

## 2. Deploy the backend

1. Push the `backend/` folder to its own GitHub repo (or a subfolder of one
   repo — either works with Vercel's root-directory setting).
2. In Vercel: **New Project → import the repo → set Root Directory to
   `backend`** (skip if it's its own repo).
3. Add every variable from `backend/.env.example` in Vercel's Environment
   Variables screen. At minimum: `DATABASE_URL`, `JWT_ACCESS_SECRET`,
   `JWT_REFRESH_SECRET`, `CORS_ORIGINS` (fill this in after step 3 below,
   once you know your frontend's URL), and the `MPESA_*` sandbox values from
   your Daraja app.
4. Deploy. Vercel builds `api/index.ts` as the serverless entry point (same
   pattern as your FlowFit backend on `fit.cctamcc.site`) — no `app.listen()`
   involved in that path.
5. Set `MPESA_CALLBACK_URL` to `https://<your-backend>.vercel.app/api/payments/mpesa/callback`
   and redeploy (env var changes need a redeploy to take effect on Vercel).
6. (Optional) In Vercel's dashboard, set a `CRON_SECRET` environment
   variable — `vercel.json` already declares two cron jobs (stale-order
   expiry every 5 minutes, meal-plan check daily) and Vercel automatically
   sends `CRON_SECRET` as a Bearer token to them, so this is the only step
   needed to make those crons authenticate correctly.

## 3. Deploy the frontend

1. Same flow: import into Vercel, Root Directory `frontend`.
2. Set `NEXT_PUBLIC_API_URL` to your backend's Vercel URL from step 2.
3. Deploy, then go back to the backend's `CORS_ORIGINS` env var and add this
   frontend URL (comma-separated if you keep a `localhost:3000` entry for
   local dev too), then redeploy the backend.

## 4. Go live with M-Pesa

The app runs end-to-end against Daraja's **sandbox** with no changes beyond
env vars. To go to production: set `MPESA_ENV=production`, replace the
sandbox consumer key/secret/shortcode/passkey with your production Till's
values from Safaricom, and re-confirm the callback URL is reachable
(Safaricom's servers must be able to reach it over HTTPS — Vercel's default
domain already satisfies that).

---

## Local development

Local dev works the same way, just pointed at `localhost`:

```
# backend
cd backend
npm install
npm run dev          # http://localhost:4000

# frontend, in another terminal/tab
cd frontend
npm install
npm run dev           # http://localhost:3000
```

Set `frontend/.env.local` with `NEXT_PUBLIC_API_URL=http://localhost:4000`,
and `backend/.env` with `CORS_ORIGINS=http://localhost:3000` alongside your
Neon `DATABASE_URL` (a local dev database works too, if you'd rather not
point dev traffic at the same Neon project you deploy from).

## Seed test accounts

All seeded phone numbers are `2547000000XX` and work with the (Kenyan
phone) login form as `07000000XX`:

| Role | Phone | Password |
|---|---|---|
| Admin | 0700000001 | `Admin@12345` |
| Vendor — Mama Njeri's Kitchen | 0700000002 | `Vendor@12345` |
| Vendor — Coastal Breeze Grill | 0700000003 | `Vendor@12345` |
| Rider | 0700000004 | `Rider@12345` |
| Customer | 0700000005 | `Customer@123` |

Change or remove these before going to production — `npm run seed` is
idempotent (safe to re-run) but does not delete anything.
