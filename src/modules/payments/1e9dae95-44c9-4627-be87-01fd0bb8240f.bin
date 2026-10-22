import { Payment, Prisma, OrderStatus, PaymentStatus, PaymentMethod, AuditAction } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { AppError } from "../../utils/AppError";
import { logger } from "../../utils/logger";
import * as mpesa from "./mpesa.service";
import { markOrderPlaced } from "../orders/order.service";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const FIRST_QUERY_AFTER_MS = 5_000; // give the callback a head start before asking Daraja
const QUERY_MIN_GAP_MS = 4_000; // don't hammer Daraja when the client polls every few seconds
const DUPLICATE_PROMPT_WINDOW_MS = 45_000; // a prompt this fresh is still waiting for the customer's PIN
const lastQueryAt = new Map<string, number>();

// ---------------------------------------------------------------------------
// Settling helpers. Everything below is idempotent and safe to call from the
// callback, the status endpoint and a retry at the same time — the M-Pesa
// result is the truth, and the order must always follow it.
// ---------------------------------------------------------------------------

// Serialises work per order inside one server instance so a callback and a
// status check landing together can't both place the order / send alerts.
const orderLocks = new Map<string, Promise<unknown>>();
async function withOrderLock<T>(orderId: string, fn: () => Promise<T>): Promise<T> {
  const previous = orderLocks.get(orderId) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(fn);
  orderLocks.set(orderId, run);
  try {
    return await run;
  } finally {
    if (orderLocks.get(orderId) === run) orderLocks.delete(orderId);
  }
}

// Moves a PAID order out of PENDING_PAYMENT. Also rescues an order the
// stale-order sweep expired while the customer's (slow) payment was still
// in flight — they paid, so the order is honoured.
async function ensureOrderPlaced(orderId: string): Promise<{ transitioned: boolean }> {
  let order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) return { transitioned: false };

  if (order.status === OrderStatus.EXPIRED) {
    logger.warn("Payment confirmed for an expired order — reinstating it", { orderId });
    await prisma.order.update({ where: { id: orderId }, data: { status: OrderStatus.PENDING_PAYMENT } });
    order = { ...order, status: OrderStatus.PENDING_PAYMENT };
  }
  if (order.status !== OrderStatus.PENDING_PAYMENT) return { transitioned: false };

  try {
    await markOrderPlaced(orderId);
    return { transitioned: true };
  } catch (err) {
    // The payment stays SUCCESS; the next status check / callback retry will
    // find the order still PENDING_PAYMENT and try again.
    logger.error("Paid order could not be placed — will retry on next check", {
      orderId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { transitioned: false };
  }
}

async function notifyOrderPlaced(orderId: string) {
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { vendor: { include: { user: true } }, customer: true },
    });
    if (!order) return;
    const { notifyOrderStatusChange, notifyVendorNewOrder } = await import("../notifications/notification.service");
    await notifyOrderStatusChange(order.customerId, order.customer.phone, order.orderNumber, "PLACED");
    await notifyVendorNewOrder(order.vendor.userId, order.vendor.user.phone, order.orderNumber);
  } catch (err) {
    logger.error("Order-placed notifications failed", { orderId, error: err instanceof Error ? err.message : String(err) });
  }
}

type SuccessInfo = { receipt?: string; resultCode?: number; resultDesc?: string; raw?: object };

// Marks a payment paid (from ANY earlier state — a late success always beats an
// earlier "failed"/"cancelled" guess) and makes sure the order is placed.
async function settleSuccess(payment: Payment, info: SuccessInfo = {}) {
  await withOrderLock(payment.orderId, async () => {
    if (payment.status !== PaymentStatus.SUCCESS) {
      const data: Prisma.PaymentUpdateManyMutationInput = { status: PaymentStatus.SUCCESS, confirmedAt: new Date() };
      if (info.receipt) data.mpesaReceiptNo = info.receipt;
      if (info.resultCode !== undefined) data.resultCode = info.resultCode;
      if (info.resultDesc) data.resultDesc = info.resultDesc;
      if (info.raw) data.rawCallbackJson = info.raw as Prisma.InputJsonValue;
      await prisma.payment.updateMany({ where: { id: payment.id, status: { not: PaymentStatus.SUCCESS } }, data });
    }
    const { transitioned } = await ensureOrderPlaced(payment.orderId);
    if (transitioned) await notifyOrderPlaced(payment.orderId);
  });
}

// A failure may only ever be written over a payment that is still PENDING — it
// can never downgrade one that has already been confirmed paid.
async function settleFailure(
  payment: Payment,
  status: PaymentStatus,
  resultCode?: number,
  resultDesc?: string,
  raw?: object
) {
  const data: Prisma.PaymentUpdateManyMutationInput = { status };
  if (resultCode !== undefined) data.resultCode = resultCode;
  if (resultDesc) data.resultDesc = resultDesc;
  if (raw) data.rawCallbackJson = raw as Prisma.InputJsonValue;
  const res = await prisma.payment.updateMany({ where: { id: payment.id, status: PaymentStatus.PENDING }, data });
  if (res.count > 0) {
    await prisma.auditLog.create({
      data: { action: AuditAction.PAYMENT_FAILED, actorType: "system", orderId: payment.orderId },
    });
  }
}

// Checks every payment on an order against the truth: repairs a paid-but-not-
// placed order, and asks Daraja about any prompt that is still pending. Safe to
// call as often as you like; never throws.
export async function reconcileOrderPayments(orderId: string) {
  try {
    const payments = await prisma.payment.findMany({ where: { orderId }, orderBy: { initiatedAt: "desc" } });

    const paid = payments.find((p) => p.status === PaymentStatus.SUCCESS);
    if (paid) {
      await settleSuccess(paid); // no-op unless the order still needs placing
      return;
    }

    for (const p of payments.filter((x) => x.status === PaymentStatus.PENDING && x.checkoutRequestId).slice(0, 3)) {
      const key = p.checkoutRequestId as string;
      const age = Date.now() - p.initiatedAt.getTime();
      if (age < FIRST_QUERY_AFTER_MS) continue;
      if (Date.now() - (lastQueryAt.get(key) ?? 0) < QUERY_MIN_GAP_MS) continue;
      lastQueryAt.set(key, Date.now());

      const outcome = await mpesa.queryStkOutcome(key);
      if (outcome.state === "SUCCESS") {
        await settleSuccess(p, { resultCode: 0, resultDesc: outcome.resultDesc });
        return;
      }
      if (outcome.state === "CANCELLED" || outcome.state === "FAILED") {
        await settleFailure(
          p,
          outcome.state === "CANCELLED" ? PaymentStatus.CANCELLED : PaymentStatus.FAILED,
          outcome.resultCode ? Number(outcome.resultCode) : undefined,
          outcome.resultDesc
        );
      }
      // PENDING: still undecided — leave it alone.
    }
  } catch (err) {
    logger.error("Payment reconciliation failed", { orderId, error: err instanceof Error ? err.message : String(err) });
  }
}

// ---------------------------------------------------------------------------

async function createPaymentRecord(data: Prisma.PaymentUncheckedCreateInput): Promise<Payment> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await prisma.payment.create({ data });
    } catch (err) {
      lastErr = err;
      await sleep(400 * attempt);
    }
  }
  // The customer already has a live M-Pesa prompt at this point, so make the
  // identifiers easy to find if it ever needs manual matching.
  logger.error("Payment record could not be saved after STK push was sent", {
    orderId: data.orderId,
    checkoutRequestId: data.checkoutRequestId,
    error: lastErr instanceof Error ? lastErr.message : String(lastErr),
  });
  throw AppError.badRequest(
    "We sent the M-Pesa prompt but hit a connection problem saving it. If you complete it, your order will still be updated — check Your orders in a minute."
  );
}

export async function initiatePaymentForOrder(userId: string, orderId: string, phone: string) {
  const found = await prisma.order.findUnique({ where: { id: orderId } });
  if (!found) throw AppError.notFound("Order not found");
  if (found.customerId !== userId) throw AppError.forbidden();

  // A previous prompt may actually have been paid (slow network, late callback).
  // Settle that first so the customer is never asked to pay twice.
  await reconcileOrderPayments(found.id);
  const order = (await prisma.order.findUnique({ where: { id: orderId } })) ?? found;

  if (order.status !== OrderStatus.PENDING_PAYMENT) {
    const alreadyPaid = await prisma.payment.findFirst({ where: { orderId, status: PaymentStatus.SUCCESS } });
    if (alreadyPaid) throw AppError.badRequest("This order is already paid — there's nothing more to pay.");
    throw AppError.badRequest("This order is not awaiting payment");
  }
  if (order.paymentExpiresAt && order.paymentExpiresAt < new Date()) {
    throw AppError.badRequest("This order's payment window has expired — please place the order again");
  }

  const recentPending = await prisma.payment.findFirst({
    where: {
      orderId: order.id,
      status: PaymentStatus.PENDING,
      initiatedAt: { gt: new Date(Date.now() - DUPLICATE_PROMPT_WINDOW_MS) },
    },
  });
  if (recentPending) {
    throw AppError.badRequest(
      "An M-Pesa prompt was just sent to your phone — enter your PIN, or wait a moment before requesting another."
    );
  }

  const stk = await mpesa.initiateStkPush({
    amount: Number(order.total),
    phone,
    orderNumber: order.orderNumber,
    description: `Mpishi254 ${order.orderNumber}`,
  });

  const payment = await createPaymentRecord({
    orderId: order.id,
    method: PaymentMethod.MPESA_STK,
    status: PaymentStatus.PENDING,
    amount: order.total,
    phoneNumber: phone,
    merchantRequestId: stk.merchantRequestId,
    checkoutRequestId: stk.checkoutRequestId,
  });

  await prisma.auditLog
    .create({ data: { action: AuditAction.PAYMENT_INITIATED, actorType: "user", actorId: userId, orderId: order.id } })
    .catch(() => undefined);

  return payment;
}

// The Daraja callback is the fastest source of truth, and the STK query (see
// reconcileOrderPayments) is the safety net when it is late or never arrives.
// checkoutRequestId is the idempotency key — Safaricom retries callbacks and a
// customer can retry a failed prompt, so this is safe to run repeatedly.
export async function handleMpesaCallback(rawBody: unknown) {
  const body = rawBody as { Body?: { stkCallback?: mpesa.DarajaStkCallback } };
  const callback = body?.Body?.stkCallback;
  if (!callback) return; // not a shape we recognise — ack and drop rather than 500

  // The callback can beat our own database write of the payment row (cold start,
  // slow connection). Wait briefly for it instead of discarding a real payment.
  let payment: Payment | null = null;
  for (let attempt = 0; attempt < 4 && !payment; attempt++) {
    if (attempt > 0) await sleep(800);
    payment = await prisma.payment.findUnique({ where: { checkoutRequestId: callback.CheckoutRequestID } });
  }
  if (!payment) {
    logger.error("M-Pesa callback for an unknown CheckoutRequestID", {
      checkoutRequestId: callback.CheckoutRequestID,
      resultCode: callback.ResultCode,
    });
    return;
  }

  if (payment.status === PaymentStatus.PENDING) {
    await prisma.auditLog.create({
      data: {
        action: AuditAction.PAYMENT_CALLBACK_RECEIVED,
        actorType: "system",
        orderId: payment.orderId,
        metadata: { resultCode: callback.ResultCode, resultDesc: callback.ResultDesc },
      },
    });
  }

  if (callback.ResultCode === 0) {
    const meta = mpesa.parseCallbackMetadata(callback);

    // M-Pesa must have collected at least what we asked for. (Underpayment is
    // the only case refused; it is logged loudly for follow-up.)
    if (meta.amount != null && Math.round(Number(meta.amount)) < Math.round(Number(payment.amount))) {
      logger.error("M-Pesa amount lower than order amount", {
        orderId: payment.orderId,
        expected: Number(payment.amount),
        received: Number(meta.amount),
      });
      await settleFailure(
        payment,
        PaymentStatus.FAILED,
        callback.ResultCode,
        "Amount mismatch between order and M-Pesa confirmation",
        rawBody as object
      );
      return;
    }

    await settleSuccess(payment, {
      receipt: meta.mpesaReceiptNumber,
      resultCode: callback.ResultCode,
      resultDesc: callback.ResultDesc,
      raw: rawBody as object,
    });
    return;
  }

  // ResultCode 1032 = cancelled by the customer on their phone; anything else
  // = failed. The order stays PENDING_PAYMENT so the customer can simply retry.
  // A payment already confirmed paid is never downgraded (settleFailure only
  // writes over PENDING).
  await settleFailure(
    payment,
    callback.ResultCode === 1032 ? PaymentStatus.CANCELLED : PaymentStatus.FAILED,
    callback.ResultCode,
    callback.ResultDesc,
    rawBody as object
  );
}

// Polled by the frontend while the customer approves the prompt (and by the
// order page whenever an order is still unpaid). Every call re-checks the
// real M-Pesa result, so a slow or missed callback can't leave a paid order
// showing as unpaid — and an unpaid one is only reported failed once M-Pesa
// itself says so.
export async function getPaymentStatus(userId: string, orderId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order || order.customerId !== userId) throw AppError.notFound("Order not found");

  await reconcileOrderPayments(orderId);

  const payments = await prisma.payment.findMany({ where: { orderId }, orderBy: { initiatedAt: "desc" } });
  const fresh = await prisma.order.findUnique({ where: { id: orderId } });
  if (!payments.length) return { status: "NONE" as const, orderStatus: fresh?.status };

  // If ANY attempt was paid, the order is paid — whatever later attempts did.
  const effective = payments.find((p) => p.status === PaymentStatus.SUCCESS) ?? payments[0];
  return { status: effective.status, orderStatus: fresh?.status };
}
