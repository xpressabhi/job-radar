import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const TIERS = ["frontier-ai", "big-tech", "saas", "india-product", "remote-first"];
export const ATS = ["gh", "lever", "ashby", "sr", "workable"];
export const CONFIDENCE = ["estimate", "verified"];

export function validateCompanies(companies, config) {
  const errors = [];
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
    if (typeof c?.careersUrl !== "string" || !/^https:\/\//.test(c.careersUrl)) {
      errors.push(`${at}: careersUrl must be an https URL`);
    }
    if (!TIERS.includes(c?.tier)) errors.push(`${at}: invalid tier "${c?.tier}"`);
    if (!c?.india || !Array.isArray(c.india.offices)) errors.push(`${at}: india.offices must be an array`);
    const pv = c?.payVetting;
    if (!pv) {
      errors.push(`${at}: missing payVetting`);
    } else {
      if (typeof pv.generalBaseMinLpa !== "number" || pv.generalBaseMinLpa < config.companyPayFloorBaseLpa) {
        errors.push(`${at}: generalBaseMinLpa below company floor (${config.companyPayFloorBaseLpa})`);
      }
      if (typeof pv.seniorBaseMinLpa !== "number" || pv.seniorBaseMinLpa < config.payFloorBaseLpa) {
        errors.push(`${at}: seniorBaseMinLpa below role floor (${config.payFloorBaseLpa})`);
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
  const config = JSON.parse(readFileSync(new URL("../data/config.json", import.meta.url), "utf8"));
  const errors = validateCompanies(companies, config);
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exit(1);
  }
  const estimates = companies.filter((c) => c.payVetting.confidence === "estimate").length;
  console.log(
    `companies.json OK — ${companies.length} companies, unique boards, bands at/above floors ` +
      `(${estimates} estimate, ${companies.length - estimates} verified)`,
  );
}
