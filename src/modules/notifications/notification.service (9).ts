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

// Password reset, via email — current default while there's no approved
// Africa's Talking sender ID for sendPasswordResetSms below. Sends a
// clickable link when FRONTEND_URL is configured, with the raw token
// underneath as a fallback the person can paste into /reset-password's
// code field (same dual-path pattern the SMS version used).
export async function sendPasswordResetEmail(to: string, rawToken: string): Promise<boolean> {
  const base = process.env.FRONTEND_URL?.trim().replace(/\/+$/, "");
  const resetLink = base ? `${base}/reset-password?token=${rawToken}` : undefined;

  return sendEmail(
    to,
    "Reset your KulaGo password",
    `<div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
       <h2 style="color: #1C1A17;">Reset your password</h2>
       <p>We received a request to reset your KulaGo account password.</p>
       ${
         resetLink
           ? `<p><a href="${resetLink}" style="display:inline-block;background:#F2A541;color:#1C1A17;font-weight:700;padding:12px 24px;border-radius:8px;text-decoration:none;margin:12px 0;">Reset my password</a></p>
              <p style="color:#8A8375;font-size:13px;">Or paste this link into your browser:<br/>${resetLink}</p>`
           : `<p style="font-size: 26px; font-weight: 700; letter-spacing: 1px; color: #C1440E; word-break: break-all;">${rawToken}</p>`
       }
       <p style="color: #8A8375; font-size: 14px;">This link/code expires in 30 minutes. If you didn't request this, you can safely ignore this email.</p>
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

// NOTE: not currently called by auth.service.ts — password reset now goes
// through sendPasswordResetEmail above, since there's no approved Africa's
// Talking sender ID yet. Left in place, untouched, to switch back to once
// that's sorted — see the commented block in auth.service.ts's
// requestPasswordReset() for exactly how this was wired in.
export async function sendPasswordResetSms(phone: string, rawToken: string): Promise<boolean> {
  const base = process.env.FRONTEND_URL?.trim().replace(/\/+$/, "");

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

// Instant SMS to the platform owner(s) when a customer's order is placed
// (i.e. paid). Numbers come from ADMIN_NOTIFY_PHONE — comma-separated for more
// than one, international format (e.g. +254712345678). Not logged to the
// Notification table, since that table is tied to a userId.
export async function notifyAdminNewOrder(orderNumber: string, vendorName: string, total: number) {
  const phones = (process.env.ADMIN_NOTIFY_PHONE ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (phones.length === 0) {
    logger.warn("Admin new-order SMS skipped — ADMIN_NOTIFY_PHONE not configured", { orderNumber });
    return;
  }
  const message = `KulaGo: new paid order ${orderNumber} from ${vendorName} - KES ${Math.round(total).toLocaleString("en-KE")}.`;
  await Promise.all(phones.map((p) => sendSms(p, message)));
}

// Full order details emailed to the platform owner(s) the moment an order is
// paid and placed. Recipients come from ADMIN_NOTIFY_EMAIL (comma-separated).
// Everything that originates from a customer (names, address, notes) is
// HTML-escaped before it goes into the message.
type AdminEmailOrder = {
  orderNumber: string;
  placedAt?: Date | null;
  scheduledFor?: Date | null;
  subtotal: unknown;
  discountTotal: unknown;
  deliveryFee: unknown;
  commissionAmt: unknown;
  total: unknown;
  specialInstructions?: string | null;
  recipientName?: string | null;
  recipientPhone?: string | null;
  vendor: { businessName: string };
  customer: { fullName?: string | null; phone?: string | null; email?: string | null };
  address?: object | null;
  items: Array<{
    nameSnapshot: string;
    quantity: number;
    unitPrice: unknown;
    lineTotal: unknown;
    notes?: string | null;
    variations: Array<{ nameSnapshot: string; priceDeltaSnapshot: unknown }>;
  }>;
  payments: Array<{ mpesaReceiptNo?: string | null; phoneNumber?: string | null; confirmedAt?: Date | null }>;
};

const escHtml = (v: unknown) =>
  String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const kes = (n: unknown) => `KES ${Number(n ?? 0).toLocaleString("en-KE", { maximumFractionDigits: 2 })}`;
const nairobiTime = (d?: Date | null) => (d ? d.toLocaleString("en-KE", { timeZone: "Africa/Nairobi" }) : "—");
const detailRow = (label: string, value: string, isHtml = false) =>
  `<tr><td style="padding:4px 14px 4px 0;color:#8A8375;vertical-align:top;white-space:nowrap;">${escHtml(label)}</td>` +
  `<td style="padding:4px 0;color:#1C1A17;">${isHtml ? value : escHtml(value || "—")}</td></tr>`;
const sectionTitle = (t: string) =>
  `<h3 style="margin:22px 0 6px;color:#C1440E;font-size:15px;text-transform:uppercase;letter-spacing:1px;">${escHtml(t)}</h3>`;

// The Address model's exact fields aren't assumed: every plain text/number
// field is listed, and latitude/longitude become a Google Maps link.
const ADDRESS_SKIP = new Set(["id", "userId", "createdAt", "updatedAt", "deletedAt", "isDefault", "latitude", "longitude"]);
function addressRows(address?: object | null): string {
  if (!address) return detailRow("Address", "—");
  const a = address as Record<string, unknown>;
  const rows = Object.entries(a)
    .filter(([k, v]) => !ADDRESS_SKIP.has(k) && (typeof v === "string" || typeof v === "number") && String(v).trim() !== "")
    .map(([k, v]) => detailRow(k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()), String(v)));
  const lat = a.latitude != null ? Number(a.latitude) : NaN;
  const lng = a.longitude != null ? Number(a.longitude) : NaN;
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    rows.push(
      detailRow("Map", `<a href="https://www.google.com/maps?q=${lat},${lng}">Open in Google Maps</a>`, true)
    );
  }
  return rows.join("");
}

export async function notifyAdminNewOrderEmail(order: AdminEmailOrder): Promise<void> {
  const recipients = (process.env.ADMIN_NOTIFY_EMAIL ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
  if (recipients.length === 0) {
    logger.warn("Admin new-order email skipped — ADMIN_NOTIFY_EMAIL not configured", { orderNumber: order.orderNumber });
    return;
  }

  const pay = order.payments[0];
  const itemsHtml = order.items
    .map((i) => {
      const variations = i.variations
        .map(
          (v) =>
            `<div style="color:#8A8375;font-size:13px;margin-left:16px;">+ ${escHtml(v.nameSnapshot)}${
              Number(v.priceDeltaSnapshot) ? ` (${kes(v.priceDeltaSnapshot)})` : ""
            }</div>`
        )
        .join("");
      const notes = i.notes
        ? `<div style="color:#8A8375;font-size:13px;margin-left:16px;">Note: ${escHtml(i.notes)}</div>`
        : "";
      return (
        `<tr><td style="padding:6px 0;border-bottom:1px solid #eee;">` +
        `<strong>${i.quantity} &times; ${escHtml(i.nameSnapshot)}</strong>${variations}${notes}</td>` +
        `<td style="padding:6px 0;border-bottom:1px solid #eee;text-align:right;white-space:nowrap;vertical-align:top;">${kes(i.lineTotal)}</td></tr>`
      );
    })
    .join("");

  const html = `<div style="font-family: sans-serif; max-width: 560px; margin: 0 auto; color:#1C1A17;">
    <h2 style="margin-bottom:4px;">New paid order ${escHtml(order.orderNumber)}</h2>
    <p style="margin-top:0;color:#8A8375;">${escHtml(order.vendor.businessName)} &middot; placed ${escHtml(nairobiTime(order.placedAt))}</p>

    ${sectionTitle("Customer")}
    <table style="border-collapse:collapse;font-size:14px;">
      ${detailRow("Name", order.customer.fullName ?? "")}
      ${detailRow("Phone", order.customer.phone ?? "")}
      ${detailRow("Email", order.customer.email ?? "")}
    </table>

    ${sectionTitle("Delivery")}
    <table style="border-collapse:collapse;font-size:14px;">
      ${order.recipientName ? detailRow("Recipient", order.recipientName) : ""}
      ${order.recipientPhone ? detailRow("Recipient phone", order.recipientPhone) : ""}
      ${addressRows(order.address)}
      ${order.scheduledFor ? detailRow("Scheduled for", nairobiTime(order.scheduledFor)) : ""}
      ${order.specialInstructions ? detailRow("Instructions", order.specialInstructions) : ""}
    </table>

    ${sectionTitle("Items")}
    <table style="border-collapse:collapse;font-size:14px;width:100%;">${itemsHtml}</table>

    ${sectionTitle("Totals")}
    <table style="border-collapse:collapse;font-size:14px;">
      ${detailRow("Subtotal", kes(order.subtotal))}
      ${Number(order.discountTotal) ? detailRow("Discount", `- ${kes(order.discountTotal)}`) : ""}
      ${detailRow("Delivery fee", kes(order.deliveryFee))}
      ${detailRow("Total paid", kes(order.total))}
      ${detailRow("Platform commission", kes(order.commissionAmt))}
    </table>

    ${sectionTitle("Payment")}
    <table style="border-collapse:collapse;font-size:14px;">
      ${detailRow("M-Pesa receipt", pay?.mpesaReceiptNo ?? "")}
      ${detailRow("Paid from", pay?.phoneNumber ?? "")}
      ${detailRow("Confirmed", nairobiTime(pay?.confirmedAt))}
    </table>
  </div>`;

  const subject = `New paid order ${order.orderNumber} - ${kes(order.total)}`;
  await Promise.all(recipients.map((to) => sendEmail(to, subject, html)));
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
