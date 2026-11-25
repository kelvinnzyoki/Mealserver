import rateLimit from "express-rate-limit";

// General API limiter
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

// Tighter limiter for auth endpoints (login/register/reset) to slow down
// credential-stuffing / brute-force attempts.
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many attempts. Please wait a few minutes and try again." },
});

// M-Pesa STK push initiation is rate-limited per signed-in USER (not per IP:
// many Kenyan mobile customers share one carrier-NAT IP, so an IP limit would
// block innocent customers while barely slowing an attacker). This route always
// runs after requireAuth. payment.service.ts adds database-backed per-user and
// per-phone limits too, because this in-memory counter is per server instance.
export const stkPushLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 10,
  keyGenerator: (req) => (req as { user?: { id: string } }).user?.id ?? "unauthenticated",
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many payment attempts. Please wait a moment and try again." },
});

// Checkout creates an order and uses up a coupon, so it is limited per user too.
export const checkoutLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 15,
  keyGenerator: (req) => (req as { user?: { id: string } }).user?.id ?? "unauthenticated",
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many orders in a short time. Please wait a few minutes and try again." },
});
