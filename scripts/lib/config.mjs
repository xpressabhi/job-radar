// Effective config = generic DEFAULTS deep-merged with the sparse `data/config.json` override.
// Scripts load config only through here; nothing else reads data/config.json directly.
// Merge semantics: plain objects merge recursively, arrays replace, scalars (incl. null) win.
// See docs/superpowers/specs/2026-09-26-configurable-job-radar-design.md.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

// Countries/regions to exclude when they appear in a posting: the home country is checked
// first (see filters), so listing it here is harmless — and warned about by the validator.
const WORLD_EXCLUDE_RE = String.raw`\b(?:united states(?: of america)?|u\.?s\.?a?\.?|usa|canada|united kingdom|germany|france|netherlands|ireland|spain|portugal|poland|romania|sweden|switzerland|singapore|australia|new zealand|japan|south korea|china|hong kong|taiwan|brazil|mexico|argentina|israel|india|united arab emirates|dubai|saudi arabia|philippines|indonesia|vietnam|thailand|malaysia|italy|denmark|norway|finland|austria|belgium|czech|hungary|greece|turkey|south africa|nigeria|kenya|egypt|pakistan|bangladesh|sri lanka|nepal|north america|south america|emea|latam|americas|europe)\b`;

const OTHER_COUNTRY_CODES = [
  "US", "CA", "GB", "UK", "DE", "FR", "NL", "IE", "ES", "PT", "PL", "RO", "SE", "CH", "SG", "AU",
  "NZ", "JP", "KR", "CN", "HK", "TW", "BR", "MX", "AR", "IL", "IN", "AE", "SA", "PH", "ID", "VN",
  "TH", "MY", "IT", "DK", "NO", "FI", "AT", "BE", "CZ", "HU", "GR", "TR", "ZA", "NG", "KE", "EG",
  "PK", "BD", "LK", "NP",
];

export const DEFAULTS = {
  site: {
    name: "Job Radar",
    title: null,
    tagline: "Engineering roles at employers vetted to pay well. Crawled daily straight from company ATS boards.",
    description: "Daily-updated engineering roles at employers vetted to pay well.",
    about: null,
    url: null,
  },
  location: {
    country: null,
    countryCode: null,
    acceptRemote: true,
    cities: {},
    excludeRegex: WORLD_EXCLUDE_RE,
    excludeRemotePatterns: [String.raw`remote\s*[-–(,|/]?\s*us\b`, String.raw`\bus[- ]remote\b`],
    excludeCountryCodes: OTHER_COUNTRY_CODES,
  },
  roles: {
    seniority: {
      includeKeywords: [],
      excludeKeywords: [],
      includePatterns: [
        { label: "senior", pattern: String.raw`\b(?:senior|sr\.?)\b` },
        { label: "staff", pattern: String.raw`\bstaff\b` },
        { label: "principal", pattern: String.raw`\bprincipal\b` },
        {
          label: "em",
          pattern: String.raw`\bengineering manager\b|\bmanager,?\s+(?:of\s+)?(?:software|engineering)\b|\bsoftware engineering manager\b`,
        },
        { label: "vp", pattern: String.raw`\bvp\b|\bvice president\b` },
        { label: "head", pattern: String.raw`\bhead of\b` },
        { label: "director", pattern: String.raw`\bdirector\b` },
        { label: "architect", pattern: String.raw`\barchitect\b` },
        { label: "lead", pattern: String.raw`\btech(?:nical)? lead\b|\blead\b|\bleader\b` },
      ],
      excludePatterns: [
        { label: "intern", pattern: String.raw`\bintern(ship)?\b` },
        { label: "new grad", pattern: String.raw`\bnew grad(uate)?\b` },
        { label: "graduate", pattern: String.raw`\bgraduate\b` },
        { label: "junior", pattern: String.raw`\bjunior\b|\bjr\.?\b` },
        { label: "associate", pattern: String.raw`\bassociate\b` },
        { label: "entry level", pattern: String.raw`\bentry[- ]level\b|\bapprentice\b` },
        { label: "engineer I/II", pattern: String.raw`\b(?:engineer|developer|sde|swe)\s+(?:i|1|ii|2)\b` },
      ],
      // Titles that look senior ("Member of Technical Staff") but are flat, senior-by-default
      // labels: they skip keyword matching and fall through to the assume-senior tier rule.
      skipSeniorPatterns: [{ label: "mts", pattern: String.raw`\bmember of technical staff\b|\bmts\b` }],
      assumeSeniorForTiers: ["frontier-ai"],
    },
    // Optional track gate: when `includePatterns` is non-empty a role's cleaned title must
    // match an include pattern and must not match any exclude pattern (exclusions first).
    // Empty defaults keep every engineering role — forks opt in.
    tracks: {
      includePatterns: [],
      excludePatterns: [],
    },
  },
  pay: {
    enabled: true,
    currency: "USD",
    floorAnnual: 0,
    companyFloorAnnual: 0,
    vettingRequired: false,
    display: { symbol: "$", divisor: 1, suffix: "", decimals: 0 },
    // Rates convert a published amount's currency into pay.currency (base = 1/omitted).
    // Empty by default; the wizard (or config) fills the currencies you actually see.
    fxRates: {},
    fxNote: "Rates convert published amounts into pay.currency; keep them conservative.",
  },
  crawl: {
    requestDelayMs: 1000,
    timeoutMs: 20000,
    retries: 1,
    archiveMisses: 2,
    userAgent: null,
  },
  llm: { maxPerRun: 40 },
};

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

const cloneValue = (v) => (isPlainObject(v) ? deepMerge({}, v) : Array.isArray(v) ? v.map(cloneValue) : v);

/** Deep-merge `override` over `base`. Objects merge, arrays replace, scalars win. */
export function deepMerge(base, override) {
  if (!isPlainObject(override)) return override === undefined ? cloneValue(base) : cloneValue(override);
  const out = isPlainObject(base) ? { ...base } : {};
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    out[key] = isPlainObject(value) ? deepMerge(base?.[key], value) : cloneValue(value);
  }
  return out;
}

/** Compile `{ label, pattern }` entries (raw regex sources) to case-insensitive regexes. */
export function compilePatterns(patterns = []) {
  return patterns.map(({ label, pattern }) => ({ label, re: new RegExp(pattern, "i") }));
}

/** Compile a plain keyword to a case-insensitive whole-word regex, escaping regex chars. */
export function keywordPattern(keyword) {
  const escaped = String(keyword).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Lookarounds instead of \b so keywords ending in non-word chars ("C++") still match.
  return { label: String(keyword).trim(), re: new RegExp(`(?<![\\w])${escaped}(?![\\w])`, "i") };
}

export function compileKeywords(keywords = []) {
  return keywords.map(keywordPattern);
}

/** Crawler identity default: derived per fork, never pointing at the upstream owner. */
export function deriveUserAgent(env = {}) {
  const repo = String(env.GITHUB_REPOSITORY ?? "").trim();
  return repo ? `job-radar/1.0 (+https://github.com/${repo})` : "job-radar/1.0";
}

/** `git@github.com:owner/repo.git` / `https://github.com/owner/repo` → `owner/repo`. */
export function parseGitHubRemote(remote) {
  if (!remote) return null;
  const m = String(remote).trim().match(/^(?:git@github\.com:|https?:\/\/github\.com\/)([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i);
  return m ? `${m[1]}/${m[2]}` : null;
}

/** Best-effort `owner/repo` for the checkout, from env first, then the git remote. */
export function resolveRepo({ env = {}, remote = null } = {}) {
  const fromEnv = String(env.GITHUB_REPOSITORY ?? "").trim();
  if (/^[^/\s]+\/[^/\s]+$/.test(fromEnv)) return fromEnv;
  return parseGitHubRemote(remote);
}

/** Best-effort synchronous read of `origin`; silent when git or the remote is absent. */
export function detectGitRemote(cwd = process.cwd()) {
  try {
    const out = execFileSync("git", ["config", "--get", "remote.origin.url"], { cwd, stdio: ["ignore", "pipe", "ignore"] });
    return String(out).trim() || null;
  } catch {
    return null;
  }
}

/**
 * Site URL for RSS/canonical links, resolved per fork: explicit override → GITHUB_REPOSITORY
 * env → git remote → null. No fork should ever claim the upstream owner's Pages URL.
 */
export function resolveSiteUrl({ config = {}, env = {}, remote = null } = {}) {
  const explicit = config.site?.url;
  if (explicit) return String(explicit);
  const repo = resolveRepo({ env, remote });
  if (!repo) return null;
  const [owner, name] = repo.split("/");
  return `https://${owner.toLowerCase()}.github.io/${name}/`;
}

/**
 * Load the effective config: clone defaults, merge the file override, drop the home
 * country's code from the exclusion list, and expose temporary legacy aliases used by
 * consumers that have not migrated to the new shape yet (removed after T20).
 */
export function loadConfig(fileConfig = {}, { env = {} } = {}) {
  const cfg = deepMerge(structuredClone(DEFAULTS), fileConfig);

  const code = cfg.location?.countryCode;
  if (code) {
    cfg.location.excludeCountryCodes = (cfg.location.excludeCountryCodes ?? []).filter(
      (c) => String(c).toUpperCase() !== String(code).toUpperCase(),
    );
  }

  Object.defineProperties(cfg, {
    // ---- legacy aliases (temporary; T18–T20 migrate consumers to the new shape) ----
    payFloorBaseLpa: { value: Math.round((cfg.pay.floorAnnual / 100000) * 10) / 10, enumerable: false },
    companyPayFloorBaseLpa: { value: Math.round((cfg.pay.companyFloorAnnual / 100000) * 10) / 10, enumerable: false },
    fxToInr: { value: cfg.pay.fxRates, enumerable: false },
    requestDelayMs: { value: cfg.crawl.requestDelayMs, enumerable: false },
    timeoutMs: { value: cfg.crawl.timeoutMs, enumerable: false },
    retries: { value: cfg.crawl.retries, enumerable: false },
    archiveMisses: { value: cfg.crawl.archiveMisses, enumerable: false },
    userAgent: { value: cfg.crawl.userAgent ?? deriveUserAgent(env), enumerable: false },
  });
  return cfg;
}

/** Read + load a config file (URL or path). */
export function loadConfigFile(file, opts) {
  return loadConfig(JSON.parse(readFileSync(file, "utf8")), opts);
}

// ---------- validation ----------

const ALLOWED_KEYS = {
  "": ["$comment", "site", "location", "roles", "pay", "crawl", "llm"],
  site: ["name", "title", "tagline", "description", "about", "url"],
  location: ["country", "countryCode", "acceptRemote", "cities", "excludeRegex", "excludeRemotePatterns", "excludeCountryCodes"],
  roles: ["seniority", "tracks"],
  "roles.seniority": [
    "includeKeywords", "excludeKeywords", "includePatterns", "excludePatterns",
    "skipSeniorPatterns", "assumeSeniorForTiers",
  ],
  "roles.tracks": ["includePatterns", "excludePatterns"],
  pay: ["enabled", "currency", "floorAnnual", "companyFloorAnnual", "vettingRequired", "display", "fxRates", "fxNote"],
  "pay.display": ["symbol", "divisor", "suffix", "decimals"],
  crawl: ["requestDelayMs", "timeoutMs", "retries", "archiveMisses", "userAgent"],
  llm: ["maxPerRun"],
};

function checkRegex(source, at, errors, { optional = false } = {}) {
  if (source == null && optional) return;
  try {
    // eslint-disable-next-line no-new
    new RegExp(String(source), "i");
  } catch (err) {
    errors.push(`${at} is not a valid regex: ${err.message}`);
  }
}

function collectUnknownKeys(cfg, errors, warnings) {
  const walk = (node, path) => {
    if (!isPlainObject(node)) return;
    const allowed = ALLOWED_KEYS[path];
    if (!allowed) return;
    for (const key of Object.keys(node)) {
      if (!allowed.includes(key)) warnings.push(`unknown key ${path ? `${path}.` : ""}${key} (ignored)`);
      const childPath = path ? `${path}.${key}` : key;
      if (isPlainObject(node[key]) && ALLOWED_KEYS[childPath]) walk(node[key], childPath);
    }
  };
  walk(cfg, "");
}

/**
 * Validate an effective config. Returns `{ errors, warnings }`; errors block crawling,
 * warnings are advisory (unknown keys are ignored but reported).
 */
export function validateConfig(cfg = {}) {
  const errors = [];
  const warnings = [];

  if (typeof cfg.location?.country !== "string" || !cfg.location.country.trim()) {
    errors.push("location.country is required — run `npm run setup` or set it in data/config.json");
  }
  if (cfg.location?.countryCode && !/^[A-Za-z]{2}$/.test(String(cfg.location.countryCode))) {
    errors.push("location.countryCode must be a two-letter country code");
  }
  if (!isPlainObject(cfg.location?.cities)) errors.push("location.cities must be an object of { alias: Display Name }");
  checkRegex(cfg.location?.excludeRegex, "location.excludeRegex", errors, { optional: true });
  for (const [i, p] of (cfg.location?.excludeRemotePatterns ?? []).entries()) {
    checkRegex(p, `location.excludeRemotePatterns[${i}]`, errors);
  }
  if (!Array.isArray(cfg.location?.excludeCountryCodes)) errors.push("location.excludeCountryCodes must be an array");

  const site = cfg.site ?? {};
if (site.title != null && typeof site.title !== "string") errors.push("site.title must be a string");
if (site.about != null && (!Array.isArray(site.about) || site.about.some((s) => typeof s !== "string"))) {
  errors.push("site.about must be an array of strings (HTML allowed)");
}
if (typeof site.name !== "string" || !site.name.trim()) errors.push("site.name must be a non-empty string");

const pay = cfg.pay ?? {};
  if (pay.enabled !== false) {
    if (typeof pay.currency !== "string" || !pay.currency.trim()) {
      errors.push("pay.currency is required when pay.enabled is true");
    }
    for (const key of ["floorAnnual", "companyFloorAnnual"]) {
      if (typeof pay[key] !== "number" || !Number.isFinite(pay[key]) || pay[key] < 0) {
        errors.push(`pay.${key} must be a non-negative number (annual, in pay.currency)`);
      }
    }
  }
  const display = pay.display ?? {};
  if (typeof display.symbol !== "string") errors.push("pay.display.symbol must be a string");
  if (typeof display.divisor !== "number" || display.divisor < 1) errors.push("pay.display.divisor must be a number >= 1");
  if (typeof display.suffix !== "string") errors.push("pay.display.suffix must be a string");
  if (!Number.isInteger(display.decimals) || display.decimals < 0 || display.decimals > 4) {
    errors.push("pay.display.decimals must be an integer between 0 and 4");
  }
  for (const [currency, rate] of Object.entries(pay.fxRates ?? {})) {
    if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {
      errors.push(`pay.fxRates.${currency} must be a positive number`);
    }
  }
  if (pay.currency && pay.fxRates?.[pay.currency] !== undefined && pay.fxRates[pay.currency] !== 1) {
    warnings.push(`pay.fxRates.${pay.currency} should be 1 (the base currency converts to itself)`);
  }

  const seniority = cfg.roles?.seniority ?? {};
  for (const list of ["includePatterns", "excludePatterns", "skipSeniorPatterns"]) {
    for (const [i, entry] of (seniority[list] ?? []).entries()) {
      if (!entry || typeof entry.pattern !== "string") errors.push(`roles.seniority.${list}[${i}] must have a string pattern`);
      else checkRegex(entry.pattern, `roles.seniority.${list}[${i}].pattern`, errors);
    }
  }
  for (const list of ["includeKeywords", "excludeKeywords"]) {
    for (const keyword of seniority[list] ?? []) {
      if (typeof keyword !== "string" || !keyword.trim()) errors.push(`roles.seniority.${list} entries must be non-empty strings`);
    }
  }
  if (!Array.isArray(seniority.assumeSeniorForTiers)) errors.push("roles.seniority.assumeSeniorForTiers must be an array of tier names");

  const tracks = cfg.roles?.tracks ?? {};
  for (const list of ["includePatterns", "excludePatterns"]) {
    for (const [i, entry] of (tracks[list] ?? []).entries()) {
      if (!entry || typeof entry.pattern !== "string") errors.push(`roles.tracks.${list}[${i}] must have a string pattern`);
      else checkRegex(entry.pattern, `roles.tracks.${list}[${i}].pattern`, errors);
    }
  }

  const crawl = cfg.crawl ?? {};
  for (const key of ["requestDelayMs", "timeoutMs"]) {
    if (typeof crawl[key] !== "number" || crawl[key] <= 0) errors.push(`crawl.${key} must be a positive number`);
  }
  if (!Number.isInteger(crawl.archiveMisses) || crawl.archiveMisses < 1) {
    errors.push("crawl.archiveMisses must be an integer >= 1");
  }

  if (typeof cfg.location?.country === "string" && cfg.location.excludeRegex) {
    // Warn only when the user overrode the default regex; home matches win regardless.
    const isCustomRegex = cfg.location.excludeRegex !== DEFAULTS.location.excludeRegex;
    if (isCustomRegex) {
      try {
        if (new RegExp(String(cfg.location.country).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(cfg.location.excludeRegex)) {
          warnings.push("location.excludeRegex mentions the home country — home matches win, but consider removing it");
        }
      } catch {
        // excludeRegex validity is reported above
      }
    }
  }

  collectUnknownKeys(cfg, errors, warnings);
  return { errors, warnings };
}
