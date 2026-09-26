import axios from "axios";
import { env } from "../../config/env";
import { logger } from "../../utils/logger";
import { prisma } from "../../config/prisma";
import { NotificationChannel, NotificationStatus, Prisma } from "@prisma/client";

// Email via Resend's REST API — a thin direct HTTP call like the Africa's
// Talking one below, no SDK dependency. Returns whether the send succeeded
// so callers (the signup-verification flow) can decide how to react to a
// failed send rather than silently pretending the code went out.
async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  if (!env.resend.apiKey) {
    logger.warn("Email not sent — RESEND_API_KEY not configured", { to });
    return false;
  }
  try {
    const { data } = await axios.post(
      "https://api.resend.com/emails",
      { from: env.resend.fromEmail, to, subject, html },
      { headers: { Authorization: `Bearer ${env.resend.apiKey}`, "Content-Type": "application/json" } }
    );
    return Boolean(data?.id);
  } catch (err) {
    logger.error("Email send failed", {
      to,
      error: axios.isAxiosError(err) ? JSON.stringify(err.response?.data) : String(err),
    });
    return false;
  }
}

export async function sendSignupVerificationEmail(to: string, code: string): Promise<boolean> {
  return sendEmail(
    to,
    "Your KulaGo verification code",
    `<div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
       <h2 style="color: #1C1A17;">Confirm your KulaGo account</h2>
       <p>Enter this code to finish creating your account:</p>
       <p style="font-size: 32px; font-weight: 700; letter-spacing: 6px; color: #C1440E;">${code}</p>
       <p style="color: #8A8375; font-size: 14px;">This code expires in 10 minutes. If you didn't request this, you can ignore this email.</p>
     </div>`
  );
}

// Status codes Africa's Talking documents as "accepted": 100 Processed,
// 101 Sent, 102 Queued. Everything else — 403 InvalidPhoneNumber,
// 405 InsufficientBalance, 406 UserInBlacklist, an unapproved sender ID,
// etc. — is a rejection, and AT still answers those with HTTP 200.
const AT_ACCEPTED_STATUS_CODES = [100, 101, 102];

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

    const { data } = await axios.post(
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
        timeout: 10_000,
      }
    );

    // A 2xx HTTP status from AT only means the request was well-formed — it
    // does NOT mean the message was accepted. The real answer is buried in
    // SMSMessageData.Recipients[0].statusCode. The previous version of this
    // function returned `true` as soon as axios didn't throw, so every
    // rejection (bad phone format, empty account balance, an unapproved
    // sender ID) was logged and treated as a successful send.
    const recipient = data?.SMSMessageData?.Recipients?.[0];
    if (!recipient || !AT_ACCEPTED_STATUS_CODES.includes(recipient.statusCode)) {
      logger.error("SMS rejected by Africa's Talking", {
        phone,
        reason: recipient?.status ?? data?.SMSMessageData?.Message ?? "no recipients in response",
        statusCode: recipient?.statusCode,
      });
      return false;
    }

    return true;
  } catch (err) {
    logger.error("SMS send failed", {
      phone,
      error: axios.isAxiosError(err) ? JSON.stringify(err.response?.data ?? err.message) : String(err),
    });
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

export async function sendPasswordResetSms(phone: string, rawToken: string): Promise<boolean> {
  // FRONTEND_URL isn't (yet) one of the variables config/env.ts validates,
  // so this reads it directly from process.env rather than through `env`.
  // If you'd rather have env.ts validate it like everything else, add it
  // there and switch this to `env.frontendUrl`.
  const base = process.env.FRONTEND_URL?.trim().replace(/\/+$/, "");

  // BUG FIXED: this used to send `rawToken.slice(0, 8)` — only the first 8
  // characters of the real token. auth.service.ts hashes and looks up the
  // FULL token, so that truncated code could never have matched even if the
  // SMS had arrived. Always send the complete token.
  const message = base
    ? `KulaGo: tap to reset your password (valid 30 min): ${base}/reset-password?token=${rawToken}`
    : `KulaGo: use this code to reset your password: ${rawToken}. Valid for 30 minutes.`;

  return sendSms(phone, message);
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
