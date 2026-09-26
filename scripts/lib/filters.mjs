// Crawl filters — the "senior engineering at well-paying employers, home-geography-eligible" gate.
// Deterministic, config-driven, no network. Order (§6): title gate → geography → pay.
import { DEFAULTS, compileKeywords, compilePatterns } from "./config.mjs";
import { parseRangeString } from "./fx.mjs";
import { convertToBase, displayStep } from "./money.mjs";
import { companyVettedMin } from "./accessors.mjs";
import { cleanTitle, canonicalUrl, dedupeKey } from "./normalize.mjs";

// ---------- Title gate: engineering + seniority (§6.3) ----------

const NON_ENGINEERING_RE =
  /\b(sales|gtm|go[- ]to[- ]market|account executive|account manager|marketing|growth|recruit\w*|talent|sourcer|people partner|human resources|content|copywriter|copy writing|designer|product manager|program manager|project manager|business analyst|finance|accounting|legal|counsel|operations manager|customer success|community|support specialist|administrative)\b/i;

const ENGINEERING_RE =
  /\b(engineer(?:ing)?|developer|devops|sre|site reliability|software|sde|swe|programmer|back[- ]?end|front[- ]?end|full[- ]?stack|platform|infrastructure|infra|cloud|database|data|machine learning|ml|ai|artificial intelligence|llm|security|cyber|qa|quality|test|automation|mobile|ios|android|embedded|firmware|architect|systems?|network|research(?:er)?|scientist|technical staff|mts|tech(?:nical)? lead|api|sdk|compiler|kernel|gpu|distributed|robotics)\b/i;

export function isEngineeringTitle(title) {
  const t = String(title ?? "");
  if (!t.trim()) return false;
  if (NON_ENGINEERING_RE.test(t)) return false;
  return ENGINEERING_RE.test(t);
}

// ---------- Seniority gate (§6.3) ----------
// Rules come from `roles.seniority` in the effective config; built-in defaults live in
// scripts/lib/config.mjs. Compiled once per config object (WeakMap).

const seniorityCache = new WeakMap();

export function seniorityRules(config = {}) {
  if (!seniorityCache.has(config)) {
    const s = config.roles?.seniority ?? DEFAULTS.roles.seniority;
    seniorityCache.set(config, {
      exclude: [...compilePatterns(s.excludePatterns), ...compileKeywords(s.excludeKeywords)],
      include: [...compilePatterns(s.includePatterns), ...compileKeywords(s.includeKeywords)],
      skip: compilePatterns(s.skipSeniorPatterns ?? []),
      assumeTiers: s.assumeSeniorForTiers ?? [],
    });
  }
  return seniorityCache.get(config);
}

/**
 * Exclusion beats inclusion. Titles matching `skipSeniorPatterns` (flat, senior-by-default
 * labels like MTS) bypass keyword matching and fall through to the assume-senior tier rule,
 * where they are flagged `tier-assumed`.
 */
export function classifySeniority(title, tier, config = {}) {
  const rules = seniorityRules(config);
  const t = String(title ?? "");
  for (const { label, re } of rules.exclude) {
    if (re.test(t)) return { keep: false, reason: `junior/mid title (${label})` };
  }
  if (!rules.skip.some(({ re }) => re.test(t))) {
    for (const { label, re } of rules.include) {
      if (re.test(t)) return { keep: true, seniority: label, levelSource: "title" };
    }
  }
  if (rules.assumeTiers.includes(tier)) {
    return { keep: true, seniority: "unlabeled", levelSource: "tier-assumed" };
  }
  return { keep: false, reason: `unlabeled title outside assumed-senior tiers (${rules.assumeTiers.join(", ") || "none"})` };
}

// ---------- Geography gate (§6.2) ----------

// ---------- Geography gate (§6.2) ----------
// Home country/cities and exclusion lists come from `location` in the effective config.
// Compiled once per config object (WeakMap).

const geographyCache = new WeakMap();

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function geographyRules(config = {}) {
  if (!geographyCache.has(config)) {
    const loc = config.location ?? DEFAULTS.location;
    const cityRes = Object.entries(loc.cities ?? {})
      .sort(([a], [b]) => b.length - a.length)
      .map(([alias, display]) => [new RegExp(`\\b${escapeRe(alias)}\\b`, "i"), display]);
    let excludeRe = null;
    try {
      excludeRe = loc.excludeRegex ? new RegExp(loc.excludeRegex, "i") : null;
    } catch {
      excludeRe = null; // invalid regexes are caught by `npm run validate:config` before crawling
    }
    let countryRe = null;
    try {
      countryRe = loc.country ? new RegExp(`\\b${escapeRe(loc.country)}\\b`, "i") : null;
    } catch {
      countryRe = null;
    }
    geographyCache.set(config, {
      cityRes,
      countryRe,
      countryCode: loc.countryCode ? String(loc.countryCode).toUpperCase() : null,
      countryLabel: loc.country ?? "home country",
      acceptRemote: loc.acceptRemote !== false,
      excludeRe,
      excludeRemoteRes: (loc.excludeRemotePatterns ?? []).map((p) => new RegExp(p, "i")),
      excludeCodes: new Set((loc.excludeCountryCodes ?? []).map((c) => String(c).toUpperCase())),
    });
  }
  return geographyCache.get(config);
}

export function classifyGeography(posting, config = {}) {
  const rules = geographyRules(config);
  const texts = [posting.locationRaw, ...(posting.locations ?? [])].filter(Boolean).map(String);
  const joined = texts.join(" | ");
  const code = typeof posting.country === "string" && posting.country.trim() ? posting.country.trim().toUpperCase() : null;

  const cities = [];
  for (const [re, display] of rules.cityRes) {
    if (!cities.includes(display) && re.test(joined)) cities.push(display);
  }
  const homeText = (rules.countryRe?.test(joined) ?? false) || cities.length > 0;
  const remote = posting.mode === "remote";

  if (homeText || (rules.countryCode && code === rules.countryCode)) {
    return { keep: true, cities, mode: posting.mode ?? null, scope: remote ? "remote_home" : "located" };
  }

  const otherCode = code && code.length === 2 && code !== rules.countryCode && rules.excludeCodes.has(code);
  const otherText = (rules.excludeRe?.test(joined) ?? false) || rules.excludeRemoteRes.some((re) => re.test(joined));
  if (otherCode || otherText) {
    return { keep: false, reason: `restricted to another geography (${code ?? ""} ${joined.slice(0, 50)})`.trim() };
  }
  if (remote && rules.acceptRemote) {
    return { keep: true, cities: [], mode: "remote", scope: "remote_global" };
  }
  return { keep: false, reason: `no ${rules.countryLabel} location signal` };
}

// ---------- Pay gate (§6.4) ----------

/**
 * Bands become money in three shapes: Lever `salaryRange`, Ashby `compensation`
 * (typed components; string fallback), Greenhouse `payInputRanges` (cents, annual base).
 * Amounts are converted to annual values in `pay.currency` (conservative rounding); the
 * floor applies to the band's LOWER bound when published; single-value total bands use
 * that value. Equity/bonus never count. `pay.enabled: false` switches the gate off.
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

  const payCfg = config.pay ?? {};
  const conversion = { rates: payCfg.fxRates ?? {}, base: payCfg.currency };
  const step = displayStep(payCfg.display ?? {});
  const gateOn = payCfg.enabled !== false;

  const vetted = companyVettedMin(company);
  if (!bands.length) {
    return { keep: true, pay: { published: false, vettedMin: vetted } };
  }

  const converted = [];
  const unsupported = [];
  for (const b of bands) {
    const basis = b.min ?? b.max;
    const basisBase = convertToBase(basis, b.currency, b.interval, conversion, step);
    if (basisBase === null) {
      unsupported.push(b.currency || "unknown");
      continue;
    }
    converted.push({
      ...b,
      basisBase,
      minBase: b.min !== null ? convertToBase(b.min, b.currency, b.interval, conversion, step) : null,
      maxBase: b.max !== null ? convertToBase(b.max, b.currency, b.interval, conversion, step) : null,
    });
  }
  if (!converted.length) {
    return {
      keep: true,
      pay: { published: false, unsupportedCurrency: [...new Set(unsupported)], vettedMin: vetted },
    };
  }

  const baseBands = converted.filter((b) => b.kind === "base");
  const pool = (baseBands.length ? baseBands : converted).sort((a, b) => b.basisBase - a.basisBase);
  const pick = pool[0];
  const floor = payCfg.floorAnnual ?? 0;
  if (gateOn && pick.basisBase < floor) {
    const label = pick.kind === "total" ? "total comp" : "base";
    return { keep: false, reason: `pay below floor (${label} ${pick.basisBase} < ${floor})` };
  }

  const pay = {
    published: true,
    currency: pick.currency,
    raw: pick.raw ?? null,
    totalOnly: pick.kind === "total" || pick.min === null,
  };
  if (pick.minBase !== null) pay.baseMin = pick.minBase;
  if (pick.maxBase !== null) pay.baseMax = pick.maxBase;
  return { keep: true, pay };
}

// ---------- Pipeline ----------

export function applyFilters({ posting, company, config }) {
  const title = cleanTitle(posting.title, config.location);
  if (!isEngineeringTitle(title)) return { keep: false, drops: ["non-engineering title"] };

  const sen = classifySeniority(title, company.tier, config);
  if (!sen.keep) return { keep: false, drops: [sen.reason] };

  const geo = classifyGeography(posting, config);
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
      location: { raw: posting.locationRaw, cities: geo.cities, mode: geo.mode, scope: geo.scope },
      pay: payRes.pay,
    },
  };
}
