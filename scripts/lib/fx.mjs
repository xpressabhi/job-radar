// Conservative FX and pay-interval math. All conversions round DOWN against the employee,
// per the design spec ("conservative"), and return INR lakhs per annum (LPA).

const INTERVAL_FACTORS = {
  year: 1,
  yearly: 1,
  yr: 1,
  annual: 1,
  annually: 1,
  "1 year": 1,
  month: 12,
  mo: 12,
  "1 month": 12,
  week: 52,
  wk: 52,
  "1 week": 52,
  day: 260,
  "1 day": 260,
  hour: 2080,
  hr: 2080,
  "1 hour": 2080,
};

export function annualize(amount, interval) {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return null;
  const key = String(interval ?? "year")
    .toLowerCase()
    .replace(/^per[- ]?/, "")
    .replace(/[-_ ]?(salary|wage|pay|base)$/, "")
    .trim();
  const factor = INTERVAL_FACTORS[key];
  return factor ? amount * factor : null;
}

export function toLpa(annualAmount, currency, fxToInr) {
  if (typeof annualAmount !== "number" || !Number.isFinite(annualAmount)) return null;
  const code = String(currency ?? "").toUpperCase();
  const rate = code === "INR" ? 1 : fxToInr?.[code];
  if (!rate) return null;
  return Math.floor(((annualAmount * rate) / 100000) * 10) / 10;
}

/** Convert a published amount+interval+currency straight to LPA. */
export function convertToLpa(amount, currency, interval, fxToInr) {
  const annual = annualize(amount, interval);
  return annual === null ? null : toLpa(annual, currency, fxToInr);
}

/**
 * Parse ranges that only exist as display strings, e.g. "CA$215K – CA$310K • Offers Equity".
 * Currency from an explicit code first, then common symbols; `$` defaults to USD.
 * Numbers accept K/M suffixes. Returns null when nothing usable is found.
 */
export function parseRangeString(text) {
  const s = String(text ?? "");
  if (!s) return null;
  let currency = (s.match(/\b(USD|CAD|EUR|GBP|INR|SGD|AUD)\b/i)?.[1] ?? "").toUpperCase();
  if (!currency) {
    if (/CA\$/.test(s)) currency = "CAD";
    else if (/US\$|\$/.test(s)) currency = "USD";
    else if (/€/.test(s)) currency = "EUR";
    else if (/£/.test(s)) currency = "GBP";
    else if (/₹/.test(s)) currency = "INR";
  }
  const SUFFIX = { k: 1000, m: 1000000, l: 100000, lpa: 100000, lakh: 100000, cr: 10000000 };
  const numbers = [...s.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*([KkMm]|[Ll](?:pa|akh)?|[Cc]r)?/g)]
    .map((m) => {
      const n = Number(m[1].replace(/,/g, ""));
      if (!Number.isFinite(n)) return null;
      const suffix = (m[2] ?? "").toLowerCase();
      return suffix ? n * (SUFFIX[suffix] ?? 1) : n;
    })
    .filter((n) => n !== null && n > 0);
  if (!numbers.length) return null;
  return { min: numbers[0], max: numbers[1] ?? numbers[0], currency };
}
