// Money: published amounts become annual values in the configured base currency
// (`pay.currency`), formatted for display. Conversion stays conservative — rounded DOWN
// against the employee at the display precision (e.g. ₹10k steps for INR lakhs).
//
// Legacy note: pre-T18 data stored INR lakhs (`baseMinLpa`); migrateLegacyPay() converts
// those to annual INR amounts so old stores/evidence stay readable.
import { annualize } from "./fx.mjs";

export const LPA_UNIT = 100000;

/** Round an amount down to a step (conservative). */
export function roundDownTo(amount, step = 1) {
  return step > 1 ? Math.floor(amount / step) * step : Math.floor(amount);
}

/**
 * Convert a published `amount` + `interval` + `currency` to an annual amount in the base
 * currency (`{ rates, base }`), rounded down to `step`. Returns null when the currency has
 * no configured rate.
 */
export function convertToBase(amount, currency, interval, { rates = {}, base } = {}, step = 1) {
  const annual = annualize(amount, interval);
  if (annual === null) return null;
  const code = String(currency ?? "").toUpperCase();
  const rate = code && code === String(base ?? "").toUpperCase() ? 1 : rates?.[code];
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) return null;
  return roundDownTo(annual * rate, step);
}

/** Step implied by the display settings: `divisor / 10^decimals` (INR lakhs → 10000). */
export function displayStep(display = {}) {
  const divisor = display.divisor ?? 1;
  const decimals = display.decimals ?? 0;
  return Math.max(1, Math.floor(divisor / 10 ** decimals));
}

/** `7000000` → `₹70L`; `185000` → `$185,000`; null/invalid → "". */
export function formatMoney(amount, display = {}) {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return "";
  const divisor = display.divisor ?? 1;
  const decimals = display.decimals ?? 0;
  const value = Number((amount / divisor).toFixed(decimals));
  const text = value.toLocaleString("en-US", { maximumFractionDigits: decimals });
  return `${display.symbol ?? ""}${text}${display.suffix ?? ""}`;
}

/** `₹50L–70L` style band; falls back to a single value when min === max. */
export function formatBand(min, max, display = {}) {
  if (min == null && max == null) return "";
  if (min != null && max != null && min !== max) {
    const { symbol = "", suffix = "" } = display;
    const divisor = display.divisor ?? 1;
    const decimals = display.decimals ?? 0;
    const fmt = (v) => Number((v / divisor).toFixed(decimals)).toLocaleString("en-US", { maximumFractionDigits: decimals });
    return `${symbol}${fmt(min)}–${fmt(max)}${suffix}`;
  }
  return formatMoney(min ?? max, display);
}

export const lpaToAnnual = (lpa) =>
  typeof lpa === "number" && Number.isFinite(lpa) ? Math.round(lpa * LPA_UNIT) : null;

export function isLegacyPay(pay) {
  return (
    !!pay &&
    (pay.baseMinLpa !== undefined || pay.baseMaxLpa !== undefined || pay.vettedSeniorMinLpa !== undefined)
  );
}

/** Rewrite a legacy INR-lakhs pay/evidence record into annual amounts. No-op when current. */
export function migrateLegacyPay(pay) {
  if (!isLegacyPay(pay)) return pay;
  const { baseMinLpa, baseMaxLpa, vettedSeniorMinLpa, ...rest } = pay;
  const next = { ...rest };
  if (baseMinLpa !== undefined) next.baseMin = lpaToAnnual(baseMinLpa);
  if (baseMaxLpa !== undefined) next.baseMax = lpaToAnnual(baseMaxLpa);
  if (vettedSeniorMinLpa !== undefined) next.vettedMin = lpaToAnnual(vettedSeniorMinLpa);
  return next;
}

/** Evidence entries use the same legacy field names as pay records. */
export const migrateLegacyEvidence = migrateLegacyPay;
