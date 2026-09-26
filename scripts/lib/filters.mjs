// Crawl filters — the "high-paying senior engineering, India-eligible" gate.
// Deterministic, config-driven, no network. Order (§6): title gate → geography → pay.
import { convertToLpa, parseRangeString } from "./fx.mjs";
import { cleanTitle, canonicalUrl, dedupeKey } from "./normalize.mjs";

// ---------- Title gate: engineering + seniority (§6.3) ----------

const NON_ENGINEERING_RE =
  /\b(sales|account executive|account manager|marketing|growth|recruit\w*|talent|sourcer|people partner|human resources|content|copywriter|copy writing|designer|product manager|program manager|project manager|business analyst|finance|accounting|legal|counsel|operations manager|customer success|community|support specialist|administrative)\b/i;

const ENGINEERING_RE =
  /\b(engineer(?:ing)?|developer|devops|sre|site reliability|software|sde|swe|programmer|back[- ]?end|front[- ]?end|full[- ]?stack|platform|infrastructure|infra|cloud|database|data|machine learning|ml|ai|artificial intelligence|llm|security|cyber|qa|quality|test|automation|mobile|ios|android|embedded|firmware|architect|systems?|network|research(?:er)?|scientist|technical staff|mts|tech(?:nical)? lead|api|sdk|compiler|kernel|gpu|distributed|robotics)\b/i;

export function isEngineeringTitle(title) {
  const t = String(title ?? "");
  if (!t.trim()) return false;
  if (NON_ENGINEERING_RE.test(t)) return false;
  return ENGINEERING_RE.test(t);
}

const JUNIOR_PATTERNS = [
  [/\bintern(ship)?\b/i, "intern"],
  [/\bnew grad(uate)?\b/i, "new grad"],
  [/\bgraduate\b/i, "graduate"],
  [/\bjunior\b|\bjr\.?\b/i, "junior"],
  [/\bassociate\b/i, "associate"],
  [/\bentry[- ]level\b|\bapprentice\b/i, "entry level"],
  [/\b(?:engineer|developer|sde|swe)\s+(?:i|1|ii|2)\b/i, "engineer I/II"],
];

const SENIOR_PATTERNS = [
  [/\b(?:senior|sr\.?)\b/i, "senior"],
  [/\bstaff\b/i, "staff"],
  [/\bprincipal\b/i, "principal"],
  [/\bengineering manager\b|\bmanager,?\s+(?:of\s+)?(?:software|engineering)\b|\bsoftware engineering manager\b/i, "em"],
  [/\bvp\b|\bvice president\b/i, "vp"],
  [/\bhead of\b/i, "head"],
  [/\bdirector\b/i, "director"],
  [/\barchitect\b/i, "architect"],
  [/\btech(?:nical)? lead\b|\blead\b|\bleader\b/i, "lead"],
];

// Titles whose words look senior but which are flat, senior-by-default labels at AI labs.
// They must skip token matching and fall through to the frontier-AI rule.
const UNLABELED_OVERRIDES = /\bmember of technical staff\b|\bmts\b/i;

/**
 * Exclusion beats inclusion. Unlabeled titles pass only at frontier-AI companies
 * (labs use flat, senior-by-default titles) and are flagged `tier-assumed`.
 */
export function classifySeniority(title, tier) {
  const t = String(title ?? "");
  for (const [re, label] of JUNIOR_PATTERNS) {
    if (re.test(t)) return { keep: false, reason: `junior/mid title (${label})` };
  }
  if (!UNLABELED_OVERRIDES.test(t)) {
    for (const [re, label] of SENIOR_PATTERNS) {
      if (re.test(t)) return { keep: true, seniority: label, levelSource: "title" };
    }
  }
  if (tier === "frontier-ai") {
    return { keep: true, seniority: "unlabeled", levelSource: "tier-assumed" };
  }
  return { keep: false, reason: "unlabeled title outside frontier-ai tier" };
}

// ---------- Geography gate (§6.2) ----------

const INDIA_CITY_ALIASES = new Map([
  ["bengaluru", "Bengaluru"], ["bangalore", "Bengaluru"], ["hyderabad", "Hyderabad"],
  ["pune", "Pune"], ["mumbai", "Mumbai"], ["navi mumbai", "Navi Mumbai"], ["thane", "Thane"],
  ["delhi", "Delhi"], ["new delhi", "New Delhi"], ["gurugram", "Gurugram"], ["gurgaon", "Gurugram"],
  ["noida", "Noida"], ["greater noida", "Greater Noida"], ["chennai", "Chennai"],
  ["kolkata", "Kolkata"], ["ahmedabad", "Ahmedabad"], ["jaipur", "Jaipur"], ["kochi", "Kochi"],
  ["cochin", "Kochi"], ["indore", "Indore"], ["coimbatore", "Coimbatore"],
  ["thiruvananthapuram", "Thiruvananthapuram"], ["trivandrum", "Thiruvananthapuram"],
  ["mysore", "Mysuru"], ["mysuru", "Mysuru"], ["mangalore", "Mangaluru"], ["nagpur", "Nagpur"],
  ["surat", "Surat"], ["vadodara", "Vadodara"], ["lucknow", "Lucknow"],
  ["bhubaneswar", "Bhubaneswar"], ["visakhapatnam", "Visakhapatnam"], ["vizag", "Visakhapatnam"],
  ["chandigarh", "Chandigarh"], ["mohali", "Mohali"], ["madurai", "Madurai"], ["nashik", "Nashik"],
  ["dehradun", "Dehradun"], ["ranchi", "Ranchi"], ["patna", "Patna"], ["guwahati", "Guwahati"],
  ["tiruchirappalli", "Tiruchirappalli"], ["trichy", "Tiruchirappalli"], ["warangal", "Warangal"],
  ["vijayawada", "Vijayawada"], ["guntur", "Guntur"], ["hubli", "Hubballi"], ["belgaum", "Belagavi"],
  ["goa", "Goa"], ["panaji", "Goa"], ["shimla", "Shimla"], ["amritsar", "Amritsar"],
]);

const CITY_RES = [...INDIA_CITY_ALIASES.keys()]
  .sort((a, b) => b.length - a.length)
  .map((alias) => [new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"), INDIA_CITY_ALIASES.get(alias)]);

const OTHER_GEO_RE =
  /\b(united states|u\.?s\.?a\.?|usa|canada|united kingdom|germany|france|netherlands|ireland|spain|portugal|poland|romania|sweden|switzerland|singapore|australia|new zealand|japan|south korea|china|hong kong|taiwan|brazil|mexico|argentina|israel|united arab emirates|dubai|saudi arabia|philippines|indonesia|vietnam|thailand|malaysia|italy|denmark|norway|finland|austria|belgium|czech|hungary|greece|turkey|south africa|nigeria|kenya|egypt|pakistan|bangladesh|sri lanka|nepal|emea|latam|americas|europe)\b/i;

const OTHER_COUNTRY_CODES = new Set([
  "US", "CA", "GB", "UK", "DE", "FR", "NL", "IE", "ES", "PT", "PL", "RO", "SE", "CH", "SG", "AU",
  "NZ", "JP", "KR", "CN", "HK", "TW", "BR", "MX", "AR", "IL", "AE", "SA", "PH", "ID", "VN", "TH",
  "MY", "IT", "DK", "NO", "FI", "AT", "BE", "CZ", "HU", "GR", "TR", "ZA", "NG", "KE", "EG", "PK",
  "BD", "LK", "NP",
]);

export function classifyGeography(posting) {
  const texts = [posting.locationRaw, ...(posting.locations ?? [])].filter(Boolean).map(String);
  const joined = texts.join(" | ");
  const code = typeof posting.country === "string" && posting.country.trim() ? posting.country.trim().toUpperCase() : null;

  const cities = [];
  for (const [re, display] of CITY_RES) {
    if (!cities.includes(display) && re.test(joined)) cities.push(display);
  }
  const indiaText = /\bindia\b/i.test(joined) || cities.length > 0;
  const remote = posting.mode === "remote";

  if (indiaText || code === "IN") {
    return { keep: true, cities, mode: posting.mode ?? null, indiaScope: remote ? "remote_india" : "located" };
  }

  const otherCode = code && code.length === 2 && code !== "IN" && OTHER_COUNTRY_CODES.has(code);
  const otherText = OTHER_GEO_RE.test(joined) || /remote\s*[-–(,|/]?\s*us\b/i.test(joined) || /\bus[- ]remote\b/i.test(joined);
  if (otherCode || otherText) {
    return { keep: false, reason: `restricted to another geography (${code ?? ""} ${joined.slice(0, 50)})`.trim() };
  }
  if (remote) {
    return { keep: true, cities: [], mode: "remote", indiaScope: "remote_global" };
  }
  return { keep: false, reason: "no India location signal" };
}

// ---------- Pay gate (§6.4) ----------

/**
 * Bands become money in three shapes: Lever `salaryRange`, Ashby `compensation`
 * (typed components; string fallback), Greenhouse `payInputRanges` (cents, annual base).
 * The floor applies to the band's LOWER bound when published ("minimum base ≥ ₹50L");
 * single-value total bands use that value. Equity/bonus never count.
 */
export function classifyPay({ posting, company, config }) {
  const bands = [];

  const sr = posting.salaryRange;
  if (sr && typeof sr === "object") {
    const min = typeof sr.min === "number" && sr.min > 0 ? sr.min : null;
    const max = typeof sr.max === "number" && sr.max > 0 ? sr.max : null;
    if (min !== null || max !== null) {
      bands.push({ min, max, currency: String(sr.currency ?? "").toUpperCase(), interval: sr.interval, kind: "base", raw: `Lever ${min ?? "?"}–${max ?? "?"} ${sr.currency ?? ""}`.trim() });
    }
  }

  const comp = posting.compensation;
  if (comp && typeof comp === "object") {
    const comps = Array.isArray(comp.summaryComponents) ? comp.summaryComponents : [];
    const salary = comps.find((c) => c?.compensationType === "Salary" && typeof c.minValue === "number" && c.minValue > 0);
    if (salary) {
      bands.push({
        min: salary.minValue,
        max: typeof salary.maxValue === "number" && salary.maxValue > 0 ? salary.maxValue : salary.minValue,
        currency: String(salary.currencyCode ?? "").toUpperCase(),
        interval: salary.interval,
        kind: "base",
        raw: comp.compensationTierSummary ?? null,
      });
    } else if (typeof comp.compensationTierSummary === "string") {
      const parsed = parseRangeString(comp.compensationTierSummary);
      if (parsed) bands.push({ ...parsed, kind: "total", raw: comp.compensationTierSummary });
    }
  }

  if (Array.isArray(posting.payInputRanges)) {
    for (const r of posting.payInputRanges) {
      if (typeof r?.min_cents === "number" && r.min_cents > 0) {
        bands.push({
          min: r.min_cents / 100,
          max: typeof r.max_cents === "number" && r.max_cents > 0 ? r.max_cents / 100 : r.min_cents / 100,
          currency: String(r.currency_type ?? "").toUpperCase(),
          interval: "year",
          kind: "base",
          raw: r.title ?? "pay transparency",
        });
      }
    }
  }

  const vetted = company.payVetting?.seniorBaseMinLpa ?? null;
  if (!bands.length) {
    return { keep: true, pay: { published: false, vettedSeniorMinLpa: vetted } };
  }

  const converted = [];
  const unsupported = [];
  for (const b of bands) {
    const basis = b.min ?? b.max;
    const basisLpa = convertToLpa(basis, b.currency, b.interval, config.fxToInr);
    if (basisLpa === null) {
      unsupported.push(b.currency || "unknown");
      continue;
    }
    converted.push({
      ...b,
      basisLpa,
      minLpa: b.min !== null ? convertToLpa(b.min, b.currency, b.interval, config.fxToInr) : null,
      maxLpa: b.max !== null ? convertToLpa(b.max, b.currency, b.interval, config.fxToInr) : null,
    });
  }
  if (!converted.length) {
    return {
      keep: true,
      pay: { published: false, unsupportedCurrency: [...new Set(unsupported)], vettedSeniorMinLpa: vetted },
    };
  }

  const baseBands = converted.filter((b) => b.kind === "base");
  const pool = (baseBands.length ? baseBands : converted).sort((a, b) => b.basisLpa - a.basisLpa);
  const pick = pool[0];
  const floor = config.payFloorBaseLpa;
  if (pick.basisLpa < floor) {
    const label = pick.kind === "total" ? "total comp" : "base";
    return { keep: false, reason: `pay below floor (${label} ${pick.basisLpa}L < ${floor}L)` };
  }

  const pay = {
    published: true,
    currency: pick.currency,
    raw: pick.raw ?? null,
    totalOnly: pick.kind === "total" || pick.min === null,
  };
  if (pick.minLpa !== null) pay.baseMinLpa = pick.minLpa;
  if (pick.maxLpa !== null) pay.baseMaxLpa = pick.maxLpa;
  return { keep: true, pay };
}

// ---------- Pipeline ----------

export function applyFilters({ posting, company, config }) {
  const title = cleanTitle(posting.title);
  if (!isEngineeringTitle(title)) return { keep: false, drops: ["non-engineering title"] };

  const sen = classifySeniority(title, company.tier);
  if (!sen.keep) return { keep: false, drops: [sen.reason] };

  const geo = classifyGeography(posting);
  if (!geo.keep) return { keep: false, drops: [geo.reason] };

  const payRes = classifyPay({ posting, company, config });
  if (!payRes.keep) return { keep: false, drops: [payRes.reason] };

  return {
    keep: true,
    drops: [],
    posting: {
      ...posting,
      title,
      url: canonicalUrl(posting.url),
      dedupeKey: dedupeKey(posting),
      seniority: sen.seniority,
      levelSource: sen.levelSource,
      location: { raw: posting.locationRaw, cities: geo.cities, mode: geo.mode, indiaScope: geo.indiaScope },
      pay: payRes.pay,
    },
  };
}
