// Tolerant readers across the pay/scope field migrations (T18/T19).
// New-shape fields win; legacy INR-lakhs / `indiaScope` values are converted on read,
// and migrate* helpers rewrite records so the next crawl write-back persists the new shape.
import { lpaToAnnual, migrateLegacyPay } from "./money.mjs";

export function payMin(pay) {
  if (!pay) return null;
  if (typeof pay.baseMin === "number") return pay.baseMin;
  return typeof pay.baseMinLpa === "number" ? lpaToAnnual(pay.baseMinLpa) : null;
}

export function payMax(pay) {
  if (!pay) return null;
  if (typeof pay.baseMax === "number") return pay.baseMax;
  return typeof pay.baseMaxLpa === "number" ? lpaToAnnual(pay.baseMaxLpa) : null;
}

export function payVetted(pay) {
  if (!pay) return null;
  if (typeof pay.vettedMin === "number") return pay.vettedMin;
  return typeof pay.vettedSeniorMinLpa === "number" ? lpaToAnnual(pay.vettedSeniorMinLpa) : null;
}

export function migratePay(pay) {
  if (pay === undefined || pay === null) return pay;
  return migrateLegacyPay(pay);
}

/** Vetted floor a company asserts, tolerant of the legacy LPA field. */
export function companyVettedMin(company) {
  const pv = company?.payVetting;
  if (!pv) return null;
  if (typeof pv.seniorBaseMin === "number") return pv.seniorBaseMin;
  if (typeof pv.seniorBaseMinLpa === "number") return lpaToAnnual(pv.seniorBaseMinLpa);
  return null;
}

/** `located | remote_home | remote_global`, tolerant of the legacy `indiaScope` values. */
export function locationScope(location) {
  const raw = location?.scope ?? location?.indiaScope ?? null;
  return raw === "remote_india" ? "remote_home" : raw;
}

export function migrateLocation(location) {
  if (!location || location.scope !== undefined) return location;
  const { indiaScope, ...rest } = location;
  return { ...rest, scope: indiaScope === "remote_india" ? "remote_home" : indiaScope ?? null };
}

export function migrateJob(record) {
  const next = { ...record };
  if (record.pay !== undefined) next.pay = migratePay(record.pay);
  if (record.location !== undefined) next.location = migrateLocation(record.location);
  return next;
}
