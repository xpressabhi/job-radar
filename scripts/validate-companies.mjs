import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadConfigFile } from "./lib/config.mjs";

export const ATS = ["gh", "lever", "ashby", "sr", "workable"];
export const CONFIDENCE = ["estimate", "verified"];

/**
 * Validate the company universe against the effective config.
 * - `tier` is free-form (optional); `location` replaces the old `india` block.
 * - `payVetting` is optional enrichment unless `pay.vettingRequired` is true; when present,
 *   `generalBaseMin` / `seniorBaseMin` are annual amounts in `pay.currency` and must clear
 *   `pay.companyFloorAnnual` / `pay.floorAnnual`.
 */
export function validateCompanies(companies, config = {}) {
  const errors = [];
  const pay = config.pay ?? {};
  const vettingRequired = pay.vettingRequired === true;

  if (!Array.isArray(companies) || companies.length === 0) {
    return ["companies.json must be a non-empty array"];
  }
  const seen = new Set();
  companies.forEach((c, i) => {
    const at = `#${i} ${c?.name ?? "<unnamed>"}`;
    if (typeof c?.name !== "string" || !c.name.trim()) errors.push(`${at}: missing name`);
    if (!ATS.includes(c?.ats)) errors.push(`${at}: invalid ats "${c?.ats}"`);
    if (typeof c?.slug !== "string" || !/^[A-Za-z0-9._-]+$/.test(c?.slug ?? "")) {
      errors.push(`${at}: invalid slug`);
    }
    const key = `${c?.ats}:${c?.slug}`;
    if (seen.has(key)) errors.push(`${at}: duplicate board ${key}`);
    seen.add(key);
    if (c?.careersUrl !== undefined && (typeof c.careersUrl !== "string" || !/^https:\/\//.test(c.careersUrl))) {
      errors.push(`${at}: careersUrl must be an https URL when present`);
    }
    if (c?.tier !== undefined && (typeof c.tier !== "string" || !c.tier.trim())) {
      errors.push(`${at}: tier must be a non-empty string when present`);
    }
    if (c?.location !== undefined) {
      if (!c.location || !Array.isArray(c.location.offices)) errors.push(`${at}: location.offices must be an array`);
      if (c.location?.remoteOk !== undefined && typeof c.location.remoteOk !== "boolean") {
        errors.push(`${at}: location.remoteOk must be boolean when present`);
      }
      if (c.location?.note !== undefined && typeof c.location.note !== "string") {
        errors.push(`${at}: location.note must be a string when present`);
      }
    }
    const pv = c?.payVetting;
    if (!pv) {
      if (vettingRequired && c?.enabled !== false) errors.push(`${at}: missing payVetting (pay.vettingRequired is true)`);
    } else {
      const floors = [
        ["generalBaseMin", pay.companyFloorAnnual ?? 0],
        ["seniorBaseMin", pay.floorAnnual ?? 0],
      ];
      for (const [field, floor] of floors) {
        if (typeof pv[field] !== "number" || !Number.isFinite(pv[field]) || pv[field] < floor) {
          errors.push(`${at}: payVetting.${field} must be a number >= ${floor} (annual, ${pay.currency ?? "base currency"})`);
        }
      }
      if (!CONFIDENCE.includes(pv.confidence)) errors.push(`${at}: invalid confidence "${pv.confidence}"`);
      if (!Array.isArray(pv.sources) || pv.sources.length === 0 || pv.sources.some((s) => typeof s !== "string" || !s.trim())) {
        errors.push(`${at}: payVetting.sources must be non-empty strings`);
      }
      if (typeof pv.verifiedOn !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(pv.verifiedOn)) {
        errors.push(`${at}: payVetting.verifiedOn must be YYYY-MM-DD`);
      }
    }
    if (typeof c?.enabled !== "boolean") errors.push(`${at}: enabled must be boolean`);
  });
  return errors;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const companies = JSON.parse(readFileSync(new URL("../data/companies.json", import.meta.url), "utf8"));
  const config = loadConfigFile(new URL("../data/config.json", import.meta.url), { env: process.env });
  const errors = validateCompanies(companies, config);
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exit(1);
  }
  const vetted = companies.filter((c) => c.payVetting);
  const estimates = vetted.filter((c) => c.payVetting.confidence === "estimate").length;
  console.log(
    `companies.json OK — ${companies.length} companies, unique boards, ` +
      `${vetted.length} with pay vetting (${estimates} estimate, ${vetted.length - estimates} verified); ` +
      `${config.pay.vettingRequired ? "vetting required" : "vetting optional"}`,
  );
}
