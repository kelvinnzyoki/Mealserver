import { prisma } from "../../config/prisma";
import { AppError } from "../../utils/AppError";
import { OrderStatus, PaymentStatus, PaymentMethod, AuditAction } from "@prisma/client";
import * as mpesa from "./mpesa.service";
import { markOrderPlaced } from "../orders/order.service";

export async function initiatePaymentForOrder(userId: string, orderId: string, phone: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw AppError.notFound("Order not found");
  if (order.customerId !== userId) throw AppError.forbidden();
  if (order.status !== OrderStatus.PENDING_PAYMENT) {
    throw AppError.badRequest("This order is not awaiting payment");
  }
  if (order.paymentExpiresAt && order.paymentExpiresAt < new Date()) {
    throw AppError.badRequest("This order's payment window has expired — please place the order again");
  }

  const stk = await mpesa.initiateStkPush({
    amount: Number(order.total),
    phone,
    orderNumber: order.orderNumber,
    description: `KulaGo ${order.orderNumber}`,
  });

  const payment = await prisma.payment.create({
    data: {
      orderId: order.id,
      method: PaymentMethod.MPESA_STK,
      status: PaymentStatus.PENDING,
      amount: order.total,
      phoneNumber: phone,
      merchantRequestId: stk.merchantRequestId,
      checkoutRequestId: stk.checkoutRequestId,
    },
  });

  await prisma.auditLog.create({
    data: { action: AuditAction.PAYMENT_INITIATED, actorType: "user", actorId: userId, orderId: order.id },
  });

  return payment;
}

// The Daraja callback is the single source of truth for "did the customer
// actually pay". checkoutRequestId is our idempotency key — Safaricom can
// and does retry callbacks, and a customer can retry a failed STK push, so
// this must be safe to call more than once for the same payment.
export async function handleMpesaCallback(rawBody: unknown) {
  const body = rawBody as {
    Body?: { stkCallback?: mpesa.DarajaStkCallback };
  };
  const callback = body?.Body?.stkCallback;
  if (!callback) {
    return; // not a shape we recognise — ack and drop rather than 500
  }

  const payment = await prisma.payment.findUnique({ where: { checkoutRequestId: callback.CheckoutRequestID } });
  if (!payment) return; // unknown checkout request — nothing to reconcile

  if (payment.status !== PaymentStatus.PENDING) {
    return; // already processed — idempotent early exit
  }

  await prisma.auditLog.create({
    data: {
      action: AuditAction.PAYMENT_CALLBACK_RECEIVED,
      actorType: "system",
      orderId: payment.orderId,
      metadata: { resultCode: callback.ResultCode, resultDesc: callback.ResultDesc },
    },
  });

  if (callback.ResultCode === 0) {
    const meta = mpesa.parseCallbackMetadata(callback);

    // Defense in depth: the amount M-Pesa actually confirms must match
    // what we asked for. A mismatch here should never silently mark an
    // order paid.
    if (meta.amount != null && Math.round(Number(meta.amount)) !== Math.round(Number(payment.amount))) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.FAILED,
          resultCode: callback.ResultCode,
          resultDesc: "Amount mismatch between order and M-Pesa confirmation",
          rawCallbackJson: rawBody as object,
        },
      });
      return;
    }

    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: PaymentStatus.SUCCESS,
        mpesaReceiptNo: meta.mpesaReceiptNumber,
        resultCode: callback.ResultCode,
        resultDesc: callback.ResultDesc,
        rawCallbackJson: rawBody as object,
        confirmedAt: new Date(),
      },
    });

    await markOrderPlaced(payment.orderId);

    const order = await prisma.order.findUnique({ where: { id: payment.orderId }, include: { vendor: { include: { user: true } }, customer: true } });
    if (order) {
      const { notifyOrderStatusChange, notifyVendorNewOrder } = await import("../notifications/notification.service");
      await notifyOrderStatusChange(order.customerId, order.customer.phone, order.orderNumber, "PLACED");
      await notifyVendorNewOrder(order.vendor.userId, order.vendor.user.phone, order.orderNumber);
    }
  } else {
    // ResultCode 1032 = cancelled by user on their phone, 1037 = timeout,
    // anything else = generic failure. All map to FAILED here; the order
    // itself stays PENDING_PAYMENT so the customer can simply retry.
    const status = callback.ResultCode === 1032 ? PaymentStatus.CANCELLED : PaymentStatus.FAILED;
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status,
        resultCode: callback.ResultCode,
        resultDesc: callback.ResultDesc,
        rawCallbackJson: rawBody as object,
      },
    });
    await prisma.auditLog.create({
      data: { action: AuditAction.PAYMENT_FAILED, actorType: "system", orderId: payment.orderId },
    });
  }
}

// Used for polling from the frontend while waiting for the customer to
// approve the STK prompt on their phone. If the callback hasn't arrived
// after a few seconds we actively query Daraja rather than leaving the
// customer staring at a spinner indefinitely.
export async function getPaymentStatus(userId: string, orderId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order || order.customerId !== userId) throw AppError.notFound("Order not found");

  const payment = await prisma.payment.findFirst({
    where: { orderId },
    orderBy: { initiatedAt: "desc" },
  });
  if (!payment) return { status: "NONE" as const };

  if (payment.status === PaymentStatus.PENDING && payment.checkoutRequestId) {
    const ageMs = Date.now() - payment.initiatedAt.getTime();
    if (ageMs > 8000) {
      try {
        const result = await mpesa.queryStkStatus(payment.checkoutRequestId);
        if (result.ResultCode === "0") {
          await markOrderPlaced(order.id);
          const refreshed = await prisma.payment.update({
            where: { id: payment.id },
            data: { status: PaymentStatus.SUCCESS, confirmedAt: new Date(), resultDesc: result.ResultDesc },
          });
          return { status: refreshed.status, orderStatus: OrderStatus.PLACED };
        }
        // Any other ResultCode from the query API is still ambiguous at this
        // point (Daraja returns 1032-style codes for "still processing" too),
        // so we deliberately don't mark the payment FAILED here — only the
        // callback or the stale-order sweep does that, to avoid a false
        // negative cancelling a payment that's about to succeed.
      } catch {
        // Query failing just means "still don't know" — fall through and
        // report PENDING; the callback may still land.
      }
    }
  }

  const fresh = await prisma.order.findUnique({ where: { id: orderId } });
  return { status: payment.status, orderStatus: fresh?.status };
}
