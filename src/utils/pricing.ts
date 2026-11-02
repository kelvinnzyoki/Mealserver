/**
 * Mpishi254 pricing: the vendor lists the price they want to be paid; the
 * platform adds a fixed per-item markup on top, and customers see the total.
 *
 *   vendor price (KES)   platform adds
 *   1 – 50               +20   (e.g. vendor 20  -> customer 40)
 *   51 – 100             +40
 *   101 – 200            +50
 *   201 – 300            +60
 *   301 – 500            +70
 *   501 and above        +80
 *
 * Keep ONE copy of this logic authoritative on the backend
 * (src/utils/pricing.ts). The frontend copy is only for previews.
 */
export const PRICE_TIERS = [
  { max: 50, markup: 20 },
  { max: 100, markup: 40 },
  { max: 200, markup: 50 },
  { max: 300, markup: 60 },
  { max: 500, markup: 70 },
  { max: Infinity, markup: 80 },
] as const;

/** Extra charge the platform adds to one unit priced at `vendorPrice`. */
export function platformMarkup(vendorPrice: number): number {
  if (!Number.isFinite(vendorPrice) || vendorPrice <= 0) return 0;
  return PRICE_TIERS.find((t) => vendorPrice <= t.max)!.markup;
}

/** What the customer pays for one unit priced at `vendorPrice`. */
export function customerPrice(vendorPrice: number): number {
  return vendorPrice + platformMarkup(vendorPrice);
}
