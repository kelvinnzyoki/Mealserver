import axios from "axios";
import { prisma } from "../../config/prisma";
import { env } from "../../config/env";
import { logger } from "../../utils/logger";
import { RECEIPT_LOGO } from "./deliveryReceipt_logo";

// ---------------------------------------------------------------------------
// Colours — the same palette as tailwind.config.ts, converted to DeviceRGB
// fractions (PDF colour operators take 0–1, not hex or 0–255).
// ---------------------------------------------------------------------------
const INK = "0.1098 0.1020 0.0902"; // #1C1A17 — exactly the logo background
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
  // Public website shown on receipts and in the receipt email.
  return envVar("RECEIPT_WEBSITE_URL") || "https://mpishikenya.cctamcc.site";
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
// ---------------------------------------------------------------------------
// Font metrics — real Helvetica / Helvetica-Bold glyph widths (per 1000 units)
// for WinAnsi codes 32..255. This lets every piece of text be measured, so it
// can be wrapped, shrunk or truncated to stay inside its own box.
// ---------------------------------------------------------------------------
type PdfFont = "F1" | "F2";
const GLYPH_W: Record<PdfFont, number[]> = {
  F1: [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584, 761, 556, 0, 222, 556, 333, 1000, 556, 556, 333, 1000, 667, 333, 1000, 0, 611, 0, 0, 222, 222, 333, 333, 350, 556, 1000, 333, 1000, 500, 333, 944, 0, 500, 667, 278, 333, 556, 556, 556, 556, 260, 556, 333, 737, 370, 556, 584, 333, 737, 333, 400, 584, 333, 333, 333, 556, 537, 278, 333, 333, 365, 556, 834, 834, 834, 611, 667, 667, 667, 667, 667, 667, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278, 722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611, 556, 556, 556, 556, 556, 556, 889, 500, 556, 556, 556, 556, 278, 278, 278, 278, 556, 556, 556, 556, 556, 556, 556, 584, 611, 556, 556, 556, 556, 500, 556, 500],
  F2: [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584, 761, 556, 0, 278, 556, 500, 1000, 556, 556, 333, 1000, 667, 333, 1000, 0, 611, 0, 0, 278, 278, 500, 500, 350, 556, 1000, 333, 1000, 556, 333, 944, 0, 500, 667, 278, 333, 556, 556, 556, 556, 280, 556, 333, 737, 370, 556, 584, 333, 737, 333, 400, 584, 333, 333, 333, 611, 556, 278, 333, 333, 365, 556, 834, 834, 834, 611, 722, 722, 722, 722, 722, 722, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278, 722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611, 556, 556, 556, 556, 556, 556, 889, 556, 556, 556, 556, 556, 278, 278, 278, 278, 611, 611, 611, 611, 611, 611, 611, 584, 611, 611, 611, 611, 611, 556, 611, 556],
};

// Characters outside plain Latin-1 that WinAnsi (cp1252) still covers.
const WIN_ANSI_MAP: Record<string, string> = {
  "\u20AC": "\x80", "\u2026": "\x85", "\u2018": "\x91", "\u2019": "\x92",
  "\u201C": "\x93", "\u201D": "\x94", "\u2022": "\x95", "\u2013": "\x96", "\u2014": "\x97",
};
// Converts any string to characters the PDF's WinAnsi fonts can draw; anything else becomes "?".
function toWinAnsi(input: unknown): string {
  let out = "";
  for (const ch of String(input ?? "")) {
    const code = ch.codePointAt(0) ?? 63;
    if (WIN_ANSI_MAP[ch]) out += WIN_ANSI_MAP[ch];
    else if ((code >= 32 && code <= 126) || (code >= 160 && code <= 255)) out += ch;
    else if (code === 9 || code === 10 || code === 13) out += " ";
    else out += "?";
  }
  return out;
}
function escapePdfText(input: unknown): string {
  return toWinAnsi(input).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}
function textWidth(value: unknown, size: number, font: PdfFont = "F1"): number {
  const table = GLYPH_W[font];
  let units = 0;
  for (const ch of toWinAnsi(value)) {
    const code = ch.charCodeAt(0);
    units += code >= 32 && code <= 255 ? table[code - 32] : 0;
  }
  return (units * size) / 1000;
}

// ---------------------------------------------------------------------------
// Raw-PDF drawing primitives — hand-written content-stream operators, no PDF
// library dependency.
// ---------------------------------------------------------------------------
type PdfCommand = string;

function text(value: unknown, x: number, y: number, size = 10, font: PdfFont = "F1", fill = INK): PdfCommand {
  return `q ${fill} rg BT /${font} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${escapePdfText(value)}) Tj ET Q\n`;
}
function textRight(value: unknown, xRight: number, y: number, size = 10, font: PdfFont = "F1", fill = INK): PdfCommand {
  return text(value, xRight - textWidth(value, size, font), y, size, font, fill);
}
function textCenter(value: unknown, xCenter: number, y: number, size = 10, font: PdfFont = "F1", fill = INK): PdfCommand {
  return text(value, xCenter - textWidth(value, size, font) / 2, y, size, font, fill);
}
function rect(x: number, y: number, w: number, h: number, stroke = LIGHT_BORDER, fill?: string): PdfCommand {
  if (fill) return `q ${fill} rg ${stroke} RG ${x} ${y} ${w} ${h} re B Q\n`;
  return `q ${stroke} RG ${x} ${y} ${w} ${h} re S Q\n`;
}
function line(x1: number, y1: number, x2: number, y2: number, stroke = LIGHT_BORDER, width = 1): PdfCommand {
  return `q ${stroke} RG ${width} w ${x1} ${y1} m ${x2} ${y2} l S Q\n`;
}

// Shortens a string with "..." until it fits maxW.
function fitEllipsis(value: unknown, maxW: number, size: number, font: PdfFont = "F1"): string {
  const v = safe(value);
  if (textWidth(v, size, font) <= maxW) return v;
  let s = v;
  while (s.length > 1 && textWidth(`${s}...`, size, font) > maxW) s = s.slice(0, -1);
  return `${s.trimEnd()}...`;
}
// Largest font size (down to minSize) at which the string fits maxW.
function fitSize(value: unknown, maxW: number, size: number, minSize: number, font: PdfFont = "F1"): number {
  let s = size;
  while (s > minSize && textWidth(value, s, font) > maxW) s -= 0.25;
  return Math.max(s, minSize);
}
// Word-wraps by real measured width; over-long words are split by character.
function wrapWidth(value: unknown, maxW: number, size: number, font: PdfFont = "F1"): string[] {
  const words = String(value ?? "").split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  const push = (w: string) => {
    const next = current ? `${current} ${w}` : w;
    if (textWidth(next, size, font) <= maxW) {
      current = next;
      return;
    }
    if (current) {
      lines.push(current);
      current = "";
    }
    if (textWidth(w, size, font) <= maxW) {
      current = w;
      return;
    }
    let chunk = "";
    for (const ch of w) {
      if (textWidth(chunk + ch, size, font) > maxW && chunk) {
        lines.push(chunk);
        chunk = ch;
      } else chunk += ch;
    }
    current = chunk;
  };
  words.forEach(push);
  if (current) lines.push(current);
  return lines.length ? lines : ["-"];
}
// Wraps to maxW and clamps to maxLines (last line gets "..." if text was cut).
function wrapClamp(value: unknown, maxW: number, size: number, font: PdfFont, maxLines: number): string[] {
  const lines = wrapWidth(value, maxW, size, font);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = fitEllipsis(`${kept[maxLines - 1]} ${lines.slice(maxLines).join(" ")}`, maxW, size, font);
  return kept;
}
function ellipsize(value: unknown, maxChars: number): string {
  const v = safe(value);
  return v.length <= maxChars ? v : `${v.slice(0, Math.max(0, maxChars - 3))}...`;
}

function fieldBox(label: string, value: unknown, x: number, y: number, w: number, h = 38, maxLines = 2): PdfCommand {
  const pad = 8;
  const lines = wrapClamp(safe(value), w - pad * 2, 8, "F1", maxLines);
  return [
    rect(x, y, w, h, LIGHT_BORDER, "1 1 1"),
    text(label, x + pad, y + h - 12, 7.5, "F2", MUTED),
    ...lines.map((l, i) => text(l, x + pad, y + h - 24 - i * 9.5, 8, "F1", INK)),
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
  const valueLines = wrapClamp(safe(value), valueW - 18, 7.5, "F1", maxValueLines);
  const baseY = yTop - rowH;
  return [
    rect(x, baseY, labelW, rowH, "0.88 0.88 0.88", "0.985 0.985 0.985"),
    rect(x + labelW, baseY, valueW, rowH, "0.88 0.88 0.88", "1 1 1"),
    text(fitEllipsis(label, labelW - 18, 7.6, "F2"), x + 9, yTop - 15, 7.6, "F2", INK),
    ...valueLines.map((l, i) => text(l, x + labelW + 9, yTop - 15 - i * 9, 7.5, "F1", INK)),
  ].join("");
}

// The real Mpishi254 logo (see deliveryReceipt_logo.ts), drawn as an image.
function drawLogo(x: number, y: number, h: number): PdfCommand {
  const w = (RECEIPT_LOGO.width / RECEIPT_LOGO.height) * h;
  return `q ${w.toFixed(2)} 0 0 ${h} ${x} ${y} cm /Im1 Do Q\n`;
}
function logoWidth(h: number): number {
  return (RECEIPT_LOGO.width / RECEIPT_LOGO.height) * h;
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
  let y = 794;

  commands.push(rect(0, 0, 595, 842, "1 1 1", "1 1 1"));

  // Header — real logo on the left, title + order line right-aligned.
  const headerH = 68;
  const logoH = 52;
  const logoW = logoWidth(logoH);
  commands.push(rect(pageLeft, y - headerH, tableWidth, headerH, INK, INK));
  commands.push(rect(pageLeft, y - headerH, tableWidth, 2.5, MARIGOLD, MARIGOLD));
  commands.push(drawLogo(pageLeft + 14, y - headerH + 9, logoH));
  const headRight = pageRight - 18;
  const headMaxW = headRight - (pageLeft + 14 + logoW + 20);
  commands.push(textRight("DELIVERY RECEIPT", headRight, y - 30, 15, "F2", "1 1 1"));
  const orderPrefix = `Order #${orderNo} \u00b7 from `;
  const vendorRoom = Math.max(30, headMaxW - textWidth(orderPrefix, 8.5, "F1"));
  commands.push(
    textRight(
      `${orderPrefix}${fitEllipsis(order.vendor.businessName, vendorRoom, 8.5, "F1")}`,
      headRight,
      y - 47,
      8.5,
      "F1",
      "0.92 0.92 0.92"
    )
  );
  y -= headerH + 16;

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
  const custH = 96;
  commands.push(rect(pageLeft, y - custH, tableWidth, custH, "0.82 0.82 0.82", LIGHT_FILL));
  commands.push(fieldBox("Customer name", order.customer.fullName, pageLeft + 12, y - 44, 152, 38));
  commands.push(fieldBox("Phone", order.customer.phone, pageLeft + 174, y - 44, 130, 38));
  commands.push(fieldBox("Email", order.customer.email, pageLeft + 12, y - 88, 292, 38));
  const addrX = pageLeft + 324;
  const addrMaxW = pageRight - 12 - addrX;
  commands.push(text("Delivery address", addrX, y - 19, 8, "F2", MUTED));
  wrapClamp(address, addrMaxW, 8, "F1", 6).forEach((l, i) => commands.push(text(l, addrX, y - 34 - i * 10, 8, "F1", INK)));
  y -= custH + 20;

  // ---- Pre-measure the blocks below the items so the items table can never run into them
  const discount = toNum(order.discountTotal);
  const deliveryFee = toNum(order.deliveryFee);
  const totalRows: [string, string][] = [
    ["Subtotal", money(order.subtotal)],
    ...(discount > 0 ? ([["Discount", `-${money(order.discountTotal)}`]] as [string, string][]) : []),
    ["Delivery fee", deliveryFee > 0 ? money(order.deliveryFee) : "Free"],
  ];
  const totalsRowH = 16;
  const totalsH = totalRows.length * totalsRowH + 36;

  const innerW = tableWidth - 28;
  const supportDesc = wrapWidth("For delivery issues, payments, or other questions, contact Mpishi254 support.", innerW, 7.8, "F1");
  const supportH = 14 + 14 + supportDesc.length * 10 + 18;
  const declLines = wrapWidth(
    "This receipt confirms the paid order above was successfully marked as delivered by Mpishi254. Keep this PDF as proof of payment and delivery.",
    innerW,
    7.8,
    "F1"
  );
  const declH = 14 + 14 + declLines.length * 10 + 8;
  const footerH = 40;
  const reserve = totalsH + 16 + supportH + 12 + declH + 14 + footerH + 14;

  // Items
  commands.push(drawSectionTitle("Items Delivered", pageLeft, y));
  y -= 30;
  const itemX = pageLeft;
  const qtyX = 352;
  const unitX = 402;
  const totalX = 482;
  const headerRowH = 24;
  commands.push(rect(itemX, y - headerRowH, tableWidth, headerRowH, INK, INK));
  commands.push(text("Item", itemX + 12, y - 15, 8.5, "F2", "1 1 1"));
  commands.push(textCenter("Qty", (qtyX + unitX) / 2, y - 15, 8.5, "F2", "1 1 1"));
  commands.push(textRight("Unit", totalX - 10, y - 15, 8.5, "F2", "1 1 1"));
  commands.push(textRight("Total", pageRight - 10, y - 15, 8.5, "F2", "1 1 1"));
  y -= headerRowH;

  if (!order.items.length) {
    commands.push(rect(itemX, y - 30, tableWidth, 30, "0.88 0.88 0.88", "1 1 1"));
    commands.push(text("No item details available on this receipt.", itemX + 12, y - 18, 8.5, "F1", INK));
    y -= 30;
  } else {
    for (const item of order.items.slice(0, 12)) {
      const nameLines = wrapClamp(itemLabel(item), qtyX - itemX - 24, 8.5, "F1", 3);
      const rowHeight = Math.max(30, nameLines.length * 12 + 14);

      if (y - rowHeight < reserve) {
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
      commands.push(textCenter(String(item.quantity), (qtyX + unitX) / 2, centerY, 8.5, "F1", INK));
      const unit = money(item.unitPrice);
      const lineTotal = money(item.lineTotal);
      commands.push(textRight(unit, totalX - 10, centerY, fitSize(unit, totalX - unitX - 16, 8.5, 6, "F1"), "F1", INK));
      commands.push(textRight(lineTotal, pageRight - 10, centerY, fitSize(lineTotal, pageRight - totalX - 16, 8.5, 6, "F1"), "F1", INK));
      y -= rowHeight;
    }
  }
  y -= 10;

  // Totals — values right-aligned inside the box
  const totalsW = 220;
  const totalsX = pageRight - totalsW;
  const totalsValueRight = totalsX + totalsW - 12;
  commands.push(rect(totalsX, y - totalsH, totalsW, totalsH, "0.82 0.82 0.82", LIGHT_FILL));
  totalRows.forEach(([label, value], i) => {
    commands.push(text(label, totalsX + 12, y - 16 - i * totalsRowH, 8, "F1", MUTED));
    commands.push(textRight(value, totalsValueRight, y - 16 - i * totalsRowH, 8, "F1", INK));
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
  const grand = money(order.total);
  commands.push(textRight(grand, totalsValueRight, y - totalsH + 12, fitSize(grand, totalsW - 80, 10, 7, "F2"), "F2", MARIGOLD_DARK));
  y -= totalsH + 16;

  // Support
  commands.push(rect(pageLeft, y - supportH, tableWidth, supportH, MARIGOLD, LIGHT_MARIGOLD_FILL));
  commands.push(text("Need help with this order?", pageLeft + 14, y - 15, 9.5, "F2", INK));
  supportDesc.forEach((l, i) => commands.push(text(l, pageLeft + 14, y - 29 - i * 10, 7.8, "F1", INK)));
  // Email / Phone / Website spread across the row by their measured widths.
  const contacts = [`Email: ${supportEmail()}`, `Phone: ${supportPhone()}`, `Website: ${siteUrl()}`];
  let cSize = 7.8;
  while (cSize > 6.4 && contacts.reduce((n, c) => n + textWidth(c, cSize, "F2"), 0) + 2 * 12 > innerW) cSize -= 0.2;
  const spare = innerW - contacts.reduce((n, c) => n + textWidth(c, cSize, "F2"), 0);
  const gap = Math.max(12, spare / (contacts.length - 1));
  const perItemMax = (innerW - gap * (contacts.length - 1)) / contacts.length;
  let cx = pageLeft + 14;
  const contactY = y - supportH + 11;
  contacts.forEach((c, i) => {
    // Only shrinks/truncates if a single value is absurdly long.
    const shown = spare >= 0 ? c : fitEllipsis(c, perItemMax, cSize, "F2");
    commands.push(text(shown, cx, contactY, cSize, "F2", MARIGOLD_DARK));
    cx += textWidth(shown, cSize, "F2") + gap;
  });
  y -= supportH + 12;

  // Declaration
  commands.push(rect(pageLeft, y - declH, tableWidth, declH, "0.78 0.78 0.78", "0.98 0.98 0.98"));
  commands.push(text("Delivery Declaration", pageLeft + 14, y - 15, 9.5, "F2", INK));
  declLines.forEach((l, i) => commands.push(text(l, pageLeft + 14, y - 29 - i * 10, 7.8, "F1", INK)));
  y -= declH + 14;

  commands.push(line(pageLeft, y, pageRight, y, MARIGOLD, 0.8));
  const thanks = "Thank you for ordering with Mpishi254 - cooked with care in Kenya.";
  commands.push(
    textCenter(thanks, pageLeft + tableWidth / 2, y - 17, fitSize(thanks, tableWidth - 20, 8, 6.5, "F2"), "F2", MARIGOLD_DARK)
  );

  // ---- Assemble the PDF as binary (text is WinAnsi/latin1; the logo is raw Flate data)
  const content = Buffer.from(commands.join(""), "latin1");
  const logoData = Buffer.from(RECEIPT_LOGO.data, "base64");
  const parts: Buffer[] = [];
  const offsets: number[] = [];
  let size = 0;
  const add = (b: Buffer | string) => {
    const buf = typeof b === "string" ? Buffer.from(b, "latin1") : b;
    parts.push(buf);
    size += buf.length;
  };
  const object = (n: number, body: Buffer | string) => {
    offsets[n] = size;
    add(`${n} 0 obj\n`);
    add(body);
    add("\nendobj\n");
  };
  const stream = (dict: string, data: Buffer): Buffer =>
    Buffer.concat([Buffer.from(`<< ${dict} /Length ${data.length} >>\nstream\n`, "latin1"), data, Buffer.from("\nendstream", "latin1")]);

  add("%PDF-1.4\n");
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  object(
    3,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> /XObject << /Im1 7 0 R >> >> /Contents 6 0 R >>"
  );
  object(4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  object(5, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  object(6, stream("", content));
  object(
    7,
    stream(
      `/Type /XObject /Subtype /Image /Width ${RECEIPT_LOGO.width} /Height ${RECEIPT_LOGO.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode`,
      logoData
    )
  );

  const count = 8;
  const xrefOffset = size;
  let xref = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let i = 1; i < count; i++) xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  add(xref);
  add(`trailer << /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);

  return Buffer.concat(parts);
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
          Website: <a href="${escapeHtml(siteUrl())}" style="color:#C97F00">${escapeHtml(siteUrl())}</a>
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
