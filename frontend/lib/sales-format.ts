/**
 * Shared number formatting for Sales & Marketing (HAMS).
 * Booking totals use a single display currency unless extended later.
 */
export const SALES_DISPLAY_CURRENCY = 'USD';

const currencyFormatter = (currencyCode: string) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currencyCode,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

export function formatSalesCurrency(amount: unknown, currencyCode: string = SALES_DISPLAY_CURRENCY): string {
  const n = typeof amount === 'string' && amount.trim() !== '' ? Number(amount) : Number(amount);
  if (!Number.isFinite(n)) return currencyFormatter(currencyCode).format(0);
  return currencyFormatter(currencyCode).format(n);
}

/**
 * Load factor is always expressed as a ratio (seats sold ÷ seats available), including >1 when oversold.
 */
export function formatLoadFactorPercent(loadFactor: unknown): string {
  const n = Number(loadFactor);
  if (!Number.isFinite(n) || n < 0) return '0.0%';
  return `${(n * 100).toFixed(1)}%`;
}

/** Percentage points with 1 decimal (e.g. commission 5.25 → "5.3%" with standard rounding). */
export function formatPercent1Decimal(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0.0%';
  return `${n.toFixed(1)}%`;
}

/** Ratio 0–1 to percent with 1 decimal (e.g. conversion 0.073 → "7.3%"). */
export function formatRatioAsPercent1Decimal(ratio: unknown): string {
  const n = Number(ratio);
  if (!Number.isFinite(n)) return '0.0%';
  const pct = n >= 0 && n <= 1 ? n * 100 : Math.min(100, n);
  return `${pct.toFixed(1)}%`;
}

/** Promo table: percent vs fixed monetary discount. */
export function formatPromoDiscountDisplay(discountType: unknown, discountValue: unknown): string {
  const t = String(discountType || '').toUpperCase();
  if (t === 'PERCENT' || t === 'PERCENTAGE') return formatPercent1Decimal(discountValue);
  return formatSalesCurrency(discountValue);
}
