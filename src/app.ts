import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import morgan from "morgan";
import { env } from "./config/env";
import { apiLimiter } from "./middleware/rateLimiter";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";

import authRoutes from "./modules/auth/auth.routes";
import userRoutes from "./modules/users/user.routes";
import vendorRoutes from "./modules/vendors/vendor.routes";
import foodRoutes from "./modules/food/food.routes";
import cartRoutes from "./modules/cart/cart.routes";
import orderRoutes from "./modules/orders/order.routes";
import paymentRoutes from "./modules/payments/payment.routes";
import riderRoutes from "./modules/riders/rider.routes";
import deliveryRoutes from "./modules/delivery/delivery.routes";
import adminRoutes from "./modules/admin/admin.routes";
import reviewRoutes from "./modules/reviews/review.routes";
import couponRoutes from "./modules/coupons/coupon.routes";
import subscriptionRoutes from "./modules/subscriptions/subscription.routes";
import zoneRoutes from "./modules/zones/zone.routes";
import internalRoutes from "./modules/internal/internal.routes";

export const app = express();

app.set("trust proxy", 1); // needed on Vercel/behind a proxy for correct req.ip in rate limiting

app.use(helmet());

// Strict origin allow-list — no wildcards. A prior project had a CORS hole
// that trusted any *.vercel.app subdomain; this instead only trusts the
// exact origins listed in CORS_ORIGINS.
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || env.corsOrigins.includes(origin)) return callback(null, true);
      callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

app.use(cookieParser());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
if (!env.isProd) app.use(morgan("dev"));
app.use("/api", apiLimiter);

app.get("/health", (_req, res) => res.json({ ok: true, service: "kulago-backend", env: env.nodeEnv }));

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/vendors", vendorRoutes);
app.use("/api/food", foodRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/riders", riderRoutes);
app.use("/api/delivery", deliveryRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/reviews", reviewRoutes);
app.use("/api/coupons", couponRoutes);
app.use("/api/subscriptions", subscriptionRoutes);
app.use("/api/zones", zoneRoutes);
app.use("/api/internal", internalRoutes);

app.use(notFoundHandler);
app.use(errorHandler);
