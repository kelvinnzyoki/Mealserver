import axios from "axios";
import { env } from "../../config/env";
import { logger } from "../../utils/logger";
import { prisma } from "../../config/prisma";
import { NotificationChannel, NotificationStatus, Prisma } from "@prisma/client";

// SMS via Africa's Talking REST API. Kept as a thin direct HTTP call rather
// than their SDK so it has zero extra dependencies and is easy to swap.
// NOTE: Africa's Talking requires an approved sender ID/short code for
// production sends — using an unregistered AT_SENDER_ID silently fails or
// falls back to a generic sender in some accounts, so confirm the sender ID
// is approved before relying on this in production.
async function sendSms(phone: string, message: string): Promise<boolean> {
  if (!env.africasTalking.apiKey || !env.africasTalking.username) {
    logger.warn("SMS not sent — Africa's Talking credentials not configured", { phone });
    return false;
  }
  try {
    const isSandbox = env.africasTalking.username === "sandbox";
    const url = isSandbox
      ? "https://api.sandbox.africastalking.com/version1/messaging"
      : "https://api.africastalking.com/version1/messaging";

    await axios.post(
      url,
      new URLSearchParams({
        username: env.africasTalking.username,
        to: phone.startsWith("+") ? phone : `+${phone}`,
        message,
        ...(env.africasTalking.senderId ? { from: env.africasTalking.senderId } : {}),
      }),
      {
        headers: {
          apiKey: env.africasTalking.apiKey,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
      }
    );
    return true;
  } catch (err) {
    logger.error("SMS send failed", { phone, error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

// Generic entry point: logs to the Notification table (for the user's
// notification center / audit trail) and then dispatches over the channel.
async function notify(params: {
  userId: string;
  channel: NotificationChannel;
  title: string;
  body: string;
  phone?: string;
  metadata?: Record<string, unknown>;
}) {
  const notification = await prisma.notification.create({
    data: {
      userId: params.userId,
      channel: params.channel,
      title: params.title,
      body: params.body,
      // Prisma's Json input type doesn't accept a generic `Record<string,
      // unknown>` — its values are typed `unknown`, which isn't provably
      // JSON-safe. The metadata we actually pass in is always plain
      // string/number/enum values, so this cast is safe.
      metadata: params.metadata as Prisma.InputJsonValue | undefined,
      status: NotificationStatus.PENDING,
    },
  });

  let sent = false;
  if (params.channel === NotificationChannel.SMS && params.phone) {
    sent = await sendSms(params.phone, params.body);
  }
  // EMAIL / PUSH channels are architected for but not wired to a live
  // provider yet — see README "What's stubbed".

  await prisma.notification.update({
    where: { id: notification.id },
    data: { status: sent ? NotificationStatus.SENT : NotificationStatus.FAILED, sentAt: sent ? new Date() : null },
  });

  return notification;
}

export async function sendPasswordResetSms(phone: string, rawToken: string) {
  // In production this should be a link into the frontend's reset page,
  // e.g. `${FRONTEND_URL}/reset-password?token=${rawToken}`.
  return sendSms(phone, `KulaGo: use this code to reset your password: ${rawToken.slice(0, 8)}. Valid for 30 minutes.`);
}

export async function notifyOrderStatusChange(userId: string, phone: string, orderNumber: string, status: string) {
  const statusCopy: Record<string, string> = {
    PLACED: `Order ${orderNumber} received and paid. The kitchen has been notified.`,
    ACCEPTED: `Good news — order ${orderNumber} has been accepted and is being prepared.`,
    PREPARING: `Order ${orderNumber} is being prepared.`,
    READY_FOR_PICKUP: `Order ${orderNumber} is ready and waiting for a rider.`,
    ASSIGNED: `A rider has been assigned to order ${orderNumber}.`,
    PICKED_UP: `Order ${orderNumber} has been picked up and is on its way.`,
    DELIVERED: `Order ${orderNumber} has been delivered. Enjoy your meal!`,
    CANCELLED: `Order ${orderNumber} was cancelled.`,
    REJECTED: `Order ${orderNumber} could not be accepted by the kitchen. A refund will be processed.`,
  };
  const body = statusCopy[status] ?? `Order ${orderNumber} status: ${status}`;
  return notify({ userId, channel: NotificationChannel.SMS, title: "Order update", body, phone });
}

export async function notifyVendorNewOrder(vendorUserId: string, phone: string, orderNumber: string) {
  return notify({
    userId: vendorUserId,
    channel: NotificationChannel.SMS,
    title: "New order",
    body: `New paid order ${orderNumber} is waiting for you to accept it on KulaGo.`,
    phone,
  });
}

export async function notifyRiderNewAssignment(riderUserId: string, phone: string, orderNumber: string) {
  return notify({
    userId: riderUserId,
    channel: NotificationChannel.SMS,
    title: "New delivery",
    body: `You've been assigned delivery for order ${orderNumber}. Open the rider app for pickup details.`,
    phone,
  });
}
