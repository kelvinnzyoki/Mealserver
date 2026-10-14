import axios from "axios";
import { prisma } from "../../config/prisma";
import { env } from "../../config/env";
import { logger } from "../../utils/logger";

// ---------------------------------------------------------------------------
// Colours — the same palette as tailwind.config.ts, converted to DeviceRGB
// fractions (PDF colour operators take 0–1, not hex or 0–255).
// ---------------------------------------------------------------------------
const INK = "0.11 0.10 0.09";
const MARIGOLD = "0.94 0.65 0.00";
const MARIGOLD_DARK = "0.79 0.50 0.00";
const CREAM = "0.98 0.96 0.93";
const MUTED = "0.54 0.51 0.46"; // ~ the `stone` token
const LIGHT_BORDER = "0.86 0.86 0.86";
const LIGHT_FILL = "0.99 0.99 0.99";
const LIGHT_MARIGOLD_FILL = "0.99 0.95 0.84";

function envVar(name: string): string {
  return process.env[name]?.trim() || "";
}

// Not (yet) validated by config/env.ts, so these read process.env directly
// and fall back to the same contact details already shown in Footer.tsx.
function supportEmail(): string {
  return envVar("SUPPORT_EMAIL") || "support@cctamcc.site";
}
function supportPhone(): string {
  return envVar("SUPPORT_PHONE") || "0789574634";
}
function siteUrl(): string {
  return envVar("FRONTEND_URL") || "https://mpishi254.vercel.app";
}

// Prisma's Decimal fields (subtotal, unitPrice, etc.) come back as a
// Decimal.js-like object, not a plain number — this covers both.
function toNum(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === "number") return value;
  const maybeDecimal = value as { toNumber?: () => number };
  return typeof maybeDecimal.toNumber === "function" ? maybeDecimal.toNumber() : Number(value);
}
function money(value: unknown): string {
  return `KES ${Math.round(toNum(value)).toLocaleString("en-KE")}`;
}
function safe(value: unknown, fallback = "-"): string {
  const s = String(value ?? "").trim();
  return s || fallback;
}

function formatPaymentMethod(method?: string | null): string {
  switch (method) {
    case "MPESA_STK":
      return "M-Pesa";
    case "MPESA_TILL_MANUAL":
      return "M-Pesa (Till)";
    case "CASH_ON_DELIVERY":
      return "Cash on delivery";
    default:
      return "-";
  }
}
function formatPaymentStatus(status?: string | null): string {
  switch (status) {
    case "SUCCESS":
      return "Paid";
    case "PENDING":
      return "Pending";
    case "FAILED":
      return "Failed";
    case "CANCELLED":
      return "Cancelled";
    case "DUPLICATE":
      return "Duplicate";
    case "TIMEOUT":
      return "Timed out";
    default:
      return "-";
  }
}

function kenyaDateTime(value?: Date | string | null): string {
  const date = value ? new Date(value) : new Date();
  return new Intl.DateTimeFormat("en-KE", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
  }).format(date);
}
function pdfKenyaDateTime(value?: Date | string | null): string {
  const date = value ? new Date(value) : new Date();
  return new Intl.DateTimeFormat("en-KE", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

function escapeHtml(input: unknown): string {
  return String(input ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function escapePdfText(input: unknown): string {
  return String(input ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/[\r\n]+/g, " ");
}

// ---------------------------------------------------------------------------
// Raw-PDF drawing primitives — same technique as the ClasicCloset receipt
// this was adapted from: hand-written content-stream operators, no PDF
// library dependency.
// ---------------------------------------------------------------------------
type PdfCommand = string;

function text(value: unknown, x: number, y: number, size = 10, font: "F1" | "F2" = "F1", fill = INK): PdfCommand {
  return `q ${fill} rg BT /${font} ${size} Tf ${x} ${y} Td (${escapePdfText(value)}) Tj ET Q\n`;
}
function rect(x: number, y: number, w: number, h: number, stroke = LIGHT_BORDER, fill?: string): PdfCommand {
  if (fill) return `q ${fill} rg ${stroke} RG ${x} ${y} ${w} ${h} re B Q\n`;
  return `q ${stroke} RG ${x} ${y} ${w} ${h} re S Q\n`;
}
function line(x1: number, y1: number, x2: number, y2: number, stroke = LIGHT_BORDER, width = 1): PdfCommand {
  return `q ${stroke} RG ${width} w ${x1} ${y1} m ${x2} ${y2} l S Q\n`;
}
function pdfCircle(cx: number, cy: number, r: number, fill: string): PdfCommand {
  const c = r * 0.5522847498;
  return `q ${fill} rg ${cx + r} ${cy} m ${cx + r} ${cy + c} ${cx + c} ${cy + r} ${cx} ${cy + r} c ${cx - c} ${cy + r} ${cx - r} ${cy + c} ${cx - r} ${cy} c ${cx - r} ${cy - c} ${cx - c} ${cy - r} ${cx} ${cy - r} c ${cx + c} ${cy - r} ${cx + r} ${cy - c} ${cx + r} ${cy} c f Q\n`;
}

function splitLongWord(word: string, maxChars: number): string[] {
  if (word.length <= maxChars) return [word];
  const parts: string[] = [];
  for (let i = 0; i < word.length; i += maxChars) parts.push(word.slice(i, i + maxChars));
  return parts;
}
function wrap(value: unknown, maxChars: number): string[] {
  const words = String(value ?? "").split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const raw of words) {
    for (const word of splitLongWord(raw, Math.max(6, maxChars))) {
      const next = current ? `${current} ${word}` : word;
      if (next.length > maxChars && current) {
        lines.push(current);
        current = word;
      } else {
        current = next;
      }
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : ["-"];
}
function ellipsize(value: unknown, maxChars: number): string {
  const v = safe(value);
  return v.length <= maxChars ? v : `${v.slice(0, Math.max(0, maxChars - 3))}...`;
}

function fieldBox(label: string, value: unknown, x: number, y: number, w: number, h = 34, maxLines = 2): PdfCommand {
  const labelY = y + h - 13;
  const valueLines = wrap(safe(value), Math.max(12, Math.floor((w - 18) / 4.8))).slice(0, maxLines);
  return [
    rect(x, y, w, h, LIGHT_BORDER, "1 1 1"),
    text(label, x + 8, labelY, 7.5, "F2", MUTED),
    ...valueLines.map((l, i) => text(l, x + 8, y + h - 26 - i * 10, 8, "F1", INK)),
  ].join("");
}
function drawSectionTitle(title: string, x: number, y: number): PdfCommand {
  return [rect(x, y - 12, 4, 14, MARIGOLD, MARIGOLD), text(title, x + 10, y - 8, 11.2, "F2", INK)].join("");
}
function drawSummaryRow(
  label: string,
  value: unknown,
  x: number,
  yTop: number,
  labelW: number,
  valueW: number,
  rowH: number,
  maxValueLines = 2
): PdfCommand {
  const valueLines = wrap(safe(value), Math.max(10, Math.floor((valueW - 18) / 4.4))).slice(0, maxValueLines);
  const baseY = yTop - rowH;
  return [
    rect(x, baseY, labelW, rowH, "0.88 0.88 0.88", "0.985 0.985 0.985"),
    rect(x + labelW, baseY, valueW, rowH, "0.88 0.88 0.88", "1 1 1"),
    text(label, x + 9, yTop - 15, 7.6, "F2", INK),
    ...valueLines.map((l, i) => text(l, x + labelW + 9, yTop - 15 - i * 9, 7.5, "F1", INK)),
  ].join("");
}

function drawMpishi254Mark(x: number, y: number): PdfCommand {
  // No vector logo file was provided, so rather than guess at the real
  // logo's shape, this draws a simple marigold "plate" — the circular dish
  // motif already used on the hero section — next to a text wordmark.
  return [
    pdfCircle(x + 14, y + 16, 13, MARIGOLD),
    pdfCircle(x + 14, y + 16, 7, INK),
    text("Mpishi", x + 38, y + 21, 15, "F2", MARIGOLD),
    text("254", x + 94, y + 21, 15, "F2", CREAM),
  ].join("");
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------
async function fetchOrderForReceipt(orderId: string) {
  return prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: {
      customer: { select: { fullName: true, email: true, phone: true } },
      vendor: { select: { businessName: true } },
      address: true,
      items: { include: { variations: true } },
      // Most recent payment attempt — covers both a single successful STK
      // push and the "FAILED, then SUCCESS on retry" case.
      payments: { orderBy: { initiatedAt: "desc" }, take: 1 },
      delivery: true,
    },
  });
}
type ReceiptOrder = Awaited<ReturnType<typeof fetchOrderForReceipt>>;

function deliveryAddress(order: ReceiptOrder): string {
  const a = order.address;
  if (!a) return order.recipientName ? `Delivered to ${order.recipientName}` : "-";
  return [a.building, a.street, a.area, a.city, a.landmark]
    .map((v) => String(v || "").trim())
    .filter(Boolean)
    .join(", ");
}
function itemLabel(item: ReceiptOrder["items"][number]): string {
  const variationNames = item.variations.map((v) => v.nameSnapshot).filter(Boolean);
  return variationNames.length ? `${item.nameSnapshot} (${variationNames.join(", ")})` : item.nameSnapshot;
}

// ---------------------------------------------------------------------------
// PDF receipt
// ---------------------------------------------------------------------------
function buildReceiptPdf(order: ReceiptOrder): Buffer {
  const commands: string[] = [];
  const payment = order.payments[0];
  const deliveredAt = pdfKenyaDateTime(order.delivery?.deliveredAt ?? order.updatedAt);
  const orderNo = safe(order.orderNumber);
  const address = deliveryAddress(order);
  const pageLeft = 36;
  const pageRight = 559;
  const tableWidth = pageRight - pageLeft;
  let y = 790;

  commands.push(rect(0, 0, 595, 842, "1 1 1", "1 1 1"));

  // Header
  commands.push(rect(pageLeft, y - 58, tableWidth, 58, INK, INK));
  commands.push(drawMpishi254Mark(pageLeft + 16, y - 46));
  commands.push(text("DELIVERY RECEIPT", pageLeft + 235, y - 20, 15, "F2", "1 1 1"));
  commands.push(
    text(`Order #${orderNo} \u00b7 from ${ellipsize(order.vendor.businessName, 28)}`, pageLeft + 235, y - 38, 8.5, "F1", "0.92 0.92 0.92")
  );
  commands.push(text("Status: DELIVERED", pageRight - 122, y - 38, 9, "F2", MARIGOLD));
  y -= 74;

  // Receipt summary
  commands.push(drawSectionTitle("Receipt Summary", pageLeft, y));
  y -= 18;
  const summaryX = pageLeft;
  const summaryTop = y;
  const summaryH = 84;
  const summaryGap = 12;
  const summaryColW = (tableWidth - summaryGap) / 2;
  const labelW = 104;
  const valueW = summaryColW - labelW;
  const rowH = summaryH / 3;
  commands.push(rect(summaryX, summaryTop - summaryH, tableWidth, summaryH, "0.82 0.82 0.82", LIGHT_FILL));
  commands.push(drawSummaryRow("Amount paid", money(order.total), summaryX, summaryTop, labelW, valueW, rowH));
  commands.push(
    drawSummaryRow("Payment method", formatPaymentMethod(payment?.method), summaryX, summaryTop - rowH, labelW, valueW, rowH)
  );
  commands.push(
    drawSummaryRow("Payment status", formatPaymentStatus(payment?.status), summaryX, summaryTop - rowH * 2, labelW, valueW, rowH)
  );
  const rightX = summaryX + summaryColW + summaryGap;
  commands.push(drawSummaryRow("M-Pesa code", payment?.mpesaReceiptNo || "-", rightX, summaryTop, labelW, valueW, rowH * 2, 3));
  commands.push(drawSummaryRow("Delivered on", deliveredAt, rightX, summaryTop - rowH * 2, labelW, valueW, rowH));
  y -= summaryH + 22;

  // Customer & delivery
  commands.push(drawSectionTitle("Customer & Delivery Details", pageLeft, y));
  y -= 18;
  commands.push(rect(pageLeft, y - 92, tableWidth, 92, "0.82 0.82 0.82", LIGHT_FILL));
  commands.push(fieldBox("Customer name", order.customer.fullName, pageLeft + 12, y - 38, 152, 32));
  commands.push(fieldBox("Phone", order.customer.phone, pageLeft + 174, y - 38, 130, 32));
  commands.push(fieldBox("Email", order.customer.email, pageLeft + 12, y - 76, 292, 32));
  commands.push(text("Delivery address", pageLeft + 324, y - 19, 8, "F2", MUTED));
  wrap(address, 40)
    .slice(0, 5)
    .forEach((l, i) => commands.push(text(l, pageLeft + 324, y - 34 - i * 10, 8, "F1", INK)));
  y -= 112;

  // Items
  commands.push(drawSectionTitle("Items Delivered", pageLeft, y));
  y -= 30;
  const itemX = pageLeft;
  const qtyX = 380;
  const unitX = 430;
  const totalX = 494;
  const headerH = 24;
  commands.push(rect(itemX, y - headerH, tableWidth, headerH, INK, INK));
  commands.push(text("Item", itemX + 12, y - 15, 8.5, "F2", "1 1 1"));
  commands.push(text("Qty", qtyX + 10, y - 15, 8.5, "F2", "1 1 1"));
  commands.push(text("Unit", unitX + 10, y - 15, 8.5, "F2", "1 1 1"));
  commands.push(text("Total", totalX + 10, y - 15, 8.5, "F2", "1 1 1"));
  y -= headerH;

  if (!order.items.length) {
    commands.push(rect(itemX, y - 30, tableWidth, 30, "0.88 0.88 0.88", "1 1 1"));
    commands.push(text("No item details available on this receipt.", itemX + 12, y - 18, 8.5, "F1", INK));
    y -= 30;
  } else {
    for (const item of order.items.slice(0, 12)) {
      const nameLines = wrap(itemLabel(item), 50).slice(0, 3);
      const rowHeight = Math.max(30, nameLines.length * 12 + 14);

      if (y - rowHeight < 172) {
        commands.push(rect(itemX, y - 24, tableWidth, 24, "0.88 0.88 0.88", "1 1 1"));
        commands.push(text("Additional items are available in the order record.", itemX + 12, y - 15, 8, "F1", MUTED));
        y -= 24;
        break;
      }

      commands.push(rect(itemX, y - rowHeight, tableWidth, rowHeight, "0.88 0.88 0.88", "1 1 1"));
      commands.push(line(qtyX, y - rowHeight, qtyX, y, "0.88 0.88 0.88"));
      commands.push(line(unitX, y - rowHeight, unitX, y, "0.88 0.88 0.88"));
      commands.push(line(totalX, y - rowHeight, totalX, y, "0.88 0.88 0.88"));
      nameLines.forEach((l, i) => commands.push(text(l, itemX + 12, y - 16 - i * 12, 8.5, "F1", INK)));
      const centerY = y - rowHeight / 2 - 3;
      commands.push(text(ellipsize(item.quantity, 6), qtyX + 12, centerY, 8.5, "F1", INK));
      commands.push(text(ellipsize(money(item.unitPrice), 14), unitX + 10, centerY, 8.5, "F1", INK));
      commands.push(text(ellipsize(money(item.lineTotal), 14), totalX + 10, centerY, 8.5, "F1", INK));
      y -= rowHeight;
    }
  }
  y -= 10;

  // Totals — fixed two-column layout (label left, value at a fixed x)
  // rather than measuring string width, matching how the rest of this PDF
  // avoids relying on real font metrics it doesn't have.
  const totalsW = 220;
  const totalsX = pageRight - totalsW;
  const totalsValueX = totalsX + 130;
  const totalsRowH = 16;
  const discount = toNum(order.discountTotal);
  const deliveryFee = toNum(order.deliveryFee);
  const totalRows: [string, string][] = [
    ["Subtotal", money(order.subtotal)],
    ...(discount > 0 ? ([["Discount", `-${money(order.discountTotal)}`]] as [string, string][]) : []),
    ["Delivery fee", deliveryFee > 0 ? money(order.deliveryFee) : "Free"],
  ];
  const totalsH = totalRows.length * totalsRowH + 26;
  commands.push(rect(totalsX, y - totalsH, totalsW, totalsH, "0.82 0.82 0.82", LIGHT_FILL));
  totalRows.forEach(([label, value], i) => {
    commands.push(text(label, totalsX + 12, y - 16 - i * totalsRowH, 8, "F1", MUTED));
    commands.push(text(value, totalsValueX, y - 16 - i * totalsRowH, 8, "F1", INK));
  });
  commands.push(
    line(
      totalsX + 12,
      y - totalRows.length * totalsRowH - 8,
      totalsX + totalsW - 12,
      y - totalRows.length * totalsRowH - 8,
      "0.7 0.7 0.7"
    )
  );
  commands.push(text("Total", totalsX + 12, y - totalsH + 12, 10, "F2", INK));
  commands.push(text(money(order.total), totalsValueX, y - totalsH + 12, 10, "F2", MARIGOLD_DARK));
  y -= totalsH + 16;

  // Support
  if (y < 142) y = 142;
  commands.push(rect(pageLeft, y - 46, tableWidth, 46, MARIGOLD, LIGHT_MARIGOLD_FILL));
  commands.push(text("Need help with this order?", pageLeft + 14, y - 15, 9.5, "F2", INK));
  commands.push(
    text("For delivery issues, payments, or other questions, contact Mpishi254 support.", pageLeft + 14, y - 29, 7.8, "F1", INK)
  );
  commands.push(text(`Email: ${ellipsize(supportEmail(), 28)}`, pageLeft + 14, y - 40, 7.8, "F2", MARIGOLD_DARK));
  commands.push(text(`Phone: ${ellipsize(supportPhone(), 18)}`, pageLeft + 220, y - 40, 7.8, "F2", MARIGOLD_DARK));
  commands.push(text(`Website: ${ellipsize(siteUrl(), 26)}`, pageLeft + 370, y - 40, 7.8, "F2", MARIGOLD_DARK));
  y -= 58;

  // Declaration
  commands.push(rect(pageLeft, y - 42, tableWidth, 42, "0.78 0.78 0.78", "0.98 0.98 0.98"));
  commands.push(text("Delivery Declaration", pageLeft + 14, y - 15, 9.5, "F2", INK));
  commands.push(
    text(
      "This receipt confirms the paid order above was successfully marked as delivered by Mpishi254.",
      pageLeft + 14,
      y - 29,
      7.8,
      "F1",
      INK
    )
  );
  commands.push(text("Keep this PDF as proof of payment and delivery.", pageLeft + 14, y - 39, 7.8, "F1", INK));
  y -= 56;

  commands.push(line(pageLeft, y, pageRight, y, MARIGOLD, 0.8));
  commands.push(text("Thank you for ordering with Mpishi254 - cooked with care in Kenya.", 160, y - 17, 8, "F2", MARIGOLD_DARK));

  const content = commands.join("");
  const objects: string[] = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >> endobj\n",
    "4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n",
    "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >> endobj\n",
    `6 0 obj << /Length ${Buffer.byteLength(content)} >> stream\n${content}endstream\nendobj\n`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += object;
  }
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf);
}

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------
function buildReceiptEmailHtml(order: ReceiptOrder): string {
  const payment = order.payments[0];
  const address = deliveryAddress(order);
  const deliveredAt = kenyaDateTime(order.delivery?.deliveredAt ?? order.updatedAt);
  const discount = toNum(order.discountTotal);
  const deliveryFee = toNum(order.deliveryFee);

  const itemRows = order.items
    .map(
      (item) => `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #eee">${escapeHtml(itemLabel(item))} \u00d7 ${item.quantity}</td>
        <td style="padding:10px 0;border-bottom:1px solid #eee;text-align:right">${escapeHtml(money(item.lineTotal))}</td>
      </tr>`
    )
    .join("");

  return `
    <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;padding:28px;color:#1C1A17;background:#FBF6EC">
      <div style="background:#ffffff;border:1px solid rgba(28,26,23,0.1);border-radius:18px;padding:26px">
        <p style="margin:0 0 4px;font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:#C97F00;font-weight:700">Mpishi254</p>
        <h1 style="margin:0 0 8px;font-size:23px;color:#1C1A17">Your order has been delivered</h1>
        <p style="margin:0 0 20px;color:#555">
          Hi ${escapeHtml(order.customer.fullName)}, your order from <strong>${escapeHtml(order.vendor.businessName)}</strong>
          was just marked as delivered. Enjoy your meal!
        </p>

        <table style="width:100%;border-collapse:collapse;margin-bottom:18px">
          <tr><td style="padding:6px 0;color:#666">Order</td><td style="padding:6px 0;text-align:right;font-weight:bold">#${escapeHtml(order.orderNumber)}</td></tr>
          <tr><td style="padding:6px 0;color:#666">Delivered</td><td style="padding:6px 0;text-align:right">${escapeHtml(deliveredAt)}</td></tr>
          <tr><td style="padding:6px 0;color:#666">Payment method</td><td style="padding:6px 0;text-align:right">${escapeHtml(formatPaymentMethod(payment?.method))}</td></tr>
          ${payment?.mpesaReceiptNo ? `<tr><td style="padding:6px 0;color:#666">M-Pesa code</td><td style="padding:6px 0;text-align:right">${escapeHtml(payment.mpesaReceiptNo)}</td></tr>` : ""}
        </table>

        <h2 style="font-size:15px;margin:20px 0 8px;color:#1C1A17">Items</h2>
        <table style="width:100%;border-collapse:collapse">
          ${itemRows || '<tr><td style="padding:10px 0;color:#666">Item details unavailable</td></tr>'}
        </table>

        <table style="width:100%;border-collapse:collapse;margin-top:6px">
          <tr><td style="padding:4px 0;color:#666">Subtotal</td><td style="padding:4px 0;text-align:right">${escapeHtml(money(order.subtotal))}</td></tr>
          ${discount > 0 ? `<tr><td style="padding:4px 0;color:#666">Discount</td><td style="padding:4px 0;text-align:right">-${escapeHtml(money(order.discountTotal))}</td></tr>` : ""}
          <tr><td style="padding:4px 0;color:#666">Delivery fee</td><td style="padding:4px 0;text-align:right">${deliveryFee > 0 ? escapeHtml(money(order.deliveryFee)) : "Free"}</td></tr>
          <tr><td style="padding:8px 0;font-weight:bold;border-top:1px solid #eee">Total</td><td style="padding:8px 0;text-align:right;font-weight:bold;border-top:1px solid #eee;color:#C97F00">${escapeHtml(money(order.total))}</td></tr>
        </table>

        <h2 style="font-size:15px;margin:20px 0 8px;color:#1C1A17">Delivered to</h2>
        <p style="background:#FBF6EC;border-radius:12px;padding:14px;line-height:1.6;margin:0 0 18px">${escapeHtml(address)}</p>

        <div style="margin-top:22px;background:#FFF8E6;border:1px solid #F0A500;border-radius:12px;padding:14px;color:#1C1A17">
          <strong>Need help with this order?</strong><br />
          Contact Mpishi254 support for delivery issues, payments, or other questions.<br />
          Email: ${escapeHtml(supportEmail())}<br />
          Phone: ${escapeHtml(supportPhone())}<br />
          Website: ${escapeHtml(siteUrl())}
        </div>

        <p style="margin-top:22px;color:#555">A PDF receipt is attached for your records.</p>
        <p style="margin-top:22px;font-size:12px;color:#8A8375">Thank you for ordering with Mpishi254 — cooked with care in Kenya.</p>
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Entry point — call this once an order's status (or its Delivery row) is
// set to DELIVERED. Takes just the order id and does its own fetch, so it
// drops into any handler with one line. Never throws: a flaky email
// provider should not block or fail the "mark delivered" action itself.
// ---------------------------------------------------------------------------
export async function sendDeliveryReceiptEmail(orderId: string): Promise<void> {
  let order: ReceiptOrder;
  try {
    order = await fetchOrderForReceipt(orderId);
  } catch (err) {
    logger.error("Delivery receipt: could not load order", {
      orderId,
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  const to = order.customer.email;
  if (!to) {
    logger.warn("Delivery receipt not sent — customer has no email on file", { orderId });
    return;
  }

  const apiKey = env.resend.apiKey;
  if (!apiKey) {
    logger.warn("Delivery receipt not sent — RESEND_API_KEY not configured", { orderId });
    return;
  }

  try {
    const pdf = buildReceiptPdf(order);
    const filename = `Mpishi254-${safe(order.orderNumber, "order")}-receipt.pdf`;

    const { data } = await axios.post(
      "https://api.resend.com/emails",
      {
        from: env.resend.fromEmail,
        to,
        subject: `Your Mpishi254 order has been delivered — #${order.orderNumber}`,
        html: buildReceiptEmailHtml(order),
        attachments: [{ filename, content: pdf.toString("base64") }],
      },
      { headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" } }
    );
    if (!data?.id) {
      logger.error("Delivery receipt email: Resend returned no id", { orderId });
    }
  } catch (err) {
    logger.error("Delivery receipt email failed", {
      orderId,
      error: axios.isAxiosError(err) ? JSON.stringify(err.response?.data ?? err.message) : String(err),
    });
  }
}
