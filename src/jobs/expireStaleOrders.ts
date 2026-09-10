import { prisma } from "../config/prisma";
import { logger } from "../utils/logger";
import { OrderStatus, PaymentStatus } from "@prisma/client";

// Prevents orders from sitting in PENDING_PAYMENT forever when a customer
// backs out of the M-Pesa prompt and never retries, and never received (or
// we never processed) a Daraja callback. Mirrors the "release reserved
// stock after 30 minutes" pattern used on ClasicCloset, generalised to
// order expiry here since KulaGo doesn't reserve stock quantities per se.
//
// This is meant to be invoked on a schedule (Vercel Cron hitting the
// protected /api/internal/jobs/expire-stale-orders endpoint is the
// recommended setup on serverless — see README) rather than run as a
// long-lived process, since Vercel functions don't stay alive between
// requests.
export async function expireStaleOrders() {
  const now = new Date();
  const stale = await prisma.order.findMany({
    where: { status: OrderStatus.PENDING_PAYMENT, paymentExpiresAt: { lt: now } },
    select: { id: true },
  });

  if (stale.length === 0) return { expired: 0 };

  const ids = stale.map((o) => o.id);
  await prisma.$transaction([
    prisma.order.updateMany({ where: { id: { in: ids } }, data: { status: OrderStatus.EXPIRED } }),
    prisma.payment.updateMany({
      where: { orderId: { in: ids }, status: PaymentStatus.PENDING },
      data: { status: PaymentStatus.TIMEOUT },
    }),
  ]);

  logger.info("Expired stale pending-payment orders", { count: ids.length });
  return { expired: ids.length };
}

// Allows `npm run jobs:expire-orders` for local/manual runs during
// development, in addition to the HTTP-triggered path used in production.
if (require.main === module) {
  expireStaleOrders()
    .then((result) => {
      console.log(result);
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
