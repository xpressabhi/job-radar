#!/usr/bin/env node
// Interactive setup wizard for forks: writes data/config.json (sparse override over built-in
// defaults) and data/companies.json, with backups. Non-interactive flags make it scriptable.
//
// Usage: node scripts/setup.mjs [--yes] [--country Germany] [--country-code DE] [--force]
//   [--company <url> ...] [--dry-run] [--data-dir <path>]
import { existsSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { DEFAULTS, deepMerge, loadConfig, validateConfig } from "./lib/config.mjs";
import { detectAts, buildEntry, appendCompany, verifyBoard } from "./add-company.mjs";

const USAGE = `Usage: node scripts/setup.mjs [options]

  --yes                    accept current/default answers (scriptable)
  --country <name>         home country (required if unset and not answering prompts)
  --country-code <ISO2>    two-letter country code
  --company <url>          import a company careers URL (repeatable)
  --no-verify              skip live board checks for imported companies
  --dry-run                print what would be written; write nothing
  --data-dir <path>        override the data directory (tests)
  --force                  write even when nothing changed
`;

const CURRENCY_PRESETS = {
  INR: { symbol: "₹", divisor: 100000, suffix: "L", decimals: 1 },
  USD: { symbol: "$", divisor: 1, suffix: "", decimals: 0 },
  EUR: { symbol: "€", divisor: 1, suffix: "", decimals: 0 },
  GBP: { symbol: "£", divisor: 1, suffix: "", decimals: 0 },
};

export function parseArgs(argv) {
  const args = { yes: false, country: null, countryCode: null, companies: [], verify: true, dryRun: false, dataDir: null, force: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--yes" || a === "-y") args.yes = true;
    else if (a === "--country") args.country = argv[++i] ?? null;
    else if (a === "--country-code") args.countryCode = argv[++i] ?? null;
    else if (a === "--company") args.companies.push(argv[++i] ?? "");
    else if (a === "--no-verify") args.verify = false;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--data-dir") args.dataDir = argv[++i] ?? null;
    else if (a === "--force") args.force = true;
    else if (a === "--help" || a === "-h") args.help = true;
  }
  return args;
}

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** Recursively strip values equal to the built-in defaults, keeping the override sparse. */
export function pruneDefaults(value, defaults) {
  if (isPlainObject(value) && isPlainObject(defaults)) {
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      if (!(key in defaults)) {
        out[key] = child;
        continue;
      }
      const pruned = pruneDefaults(child, defaults[key]);
      if (pruned !== undefined) out[key] = pruned;
    }
    return Object.keys(out).length ? out : undefined;
  }
  if (Array.isArray(value) && Array.isArray(defaults) && JSON.stringify(value) === JSON.stringify(defaults)) return undefined;
  return JSON.stringify(value) === JSON.stringify(defaults) ? undefined : value;
}

const parseRateList = (answer) => {
  const rates = {};
  for (const pair of String(answer ?? "").split(/[,;]+/)) {
    const [currency, rate] = pair.split(":").map((s) => s.trim());
    if (currency && rate && Number(rate) > 0) rates[currency.toUpperCase()] = Number(rate);
  }
  return rates;
};

const parseCityList = (answer) => {
  const cities = {};
  for (const raw of String(answer ?? "").split(/[,;]+/)) {
    const display = raw.trim();
    if (display) cities[display.toLowerCase()] = display;
  }
  return cities;
};

export function buildOverrides({ base, answers }) {
  const extraKeywords = String(answers.extraSeniorKeywords ?? "")
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const overrides = {
    site: {
      name: answers.siteName,
      tagline: answers.tagline,
      description: answers.description,
    },
    location: {
      country: answers.country,
      countryCode: answers.countryCode || undefined,
      acceptRemote: answers.acceptRemote,
      cities: answers.cities,
    },
    roles: extraKeywords.length ? { seniority: { includeKeywords: extraKeywords } } : undefined,
    pay: {
      enabled: answers.payEnabled,
      currency: answers.currency,
      floorAnnual: answers.floorAnnual,
      companyFloorAnnual: answers.companyFloorAnnual,
      display: CURRENCY_PRESETS[answers.currency] ?? base.pay?.display,
      fxRates: Object.keys(answers.fxRates ?? {}).length ? answers.fxRates : base.pay?.fxRates,
    },
  };
  return overrides;
}

async function promptAll(io, base, args) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = async (question, fallback) => {
    const shown = fallback === undefined || fallback === null || fallback === "" ? "" : ` [${fallback}]`;
    const answer = (await rl.question(`${question}${shown}: `)).trim();
    return answer || fallback;
  };
  try {
    const country = args.country ?? (await ask("Home country", base.location.country ?? ""));
    if (!country) throw new Error("a home country is required (or pass --country)");
    const countryCode = args.countryCode ?? (await ask("Country code (ISO-2)", base.location.countryCode ?? ""));
    const citiesAnswer = await ask("Cities (comma-separated display names; blank keeps current)", "");
    const currency = (await ask("Pay currency", base.pay.currency ?? "USD")).toUpperCase();
    const payEnabled = (await ask("Gate roles by pay floor? (yes/no)", base.pay.enabled === false ? "no" : "yes")).toLowerCase().startsWith("y");
    const floorAnswer = await ask(`Senior base floor (annual, ${currency})`, base.pay.floorAnnual ?? 0);
    const companyFloorAnswer = await ask(`Company general floor (annual, ${currency})`, base.pay.companyFloorAnnual ?? 0);
    const ratesAnswer = await ask("FX rates into the base currency (e.g. USD:87,EUR:95; blank keeps current)", "");
    return {
      siteName: await ask("Site name", base.site.name),
      tagline: await ask("Tagline", base.site.tagline),
      description: await ask("Meta description", base.site.description),
      country,
      countryCode,
      cities: citiesAnswer ? parseCityList(citiesAnswer) : base.location.cities,
      acceptRemote: (await ask("Keep unrestricted-remote roles (flagged verify)? (yes/no)", base.location.acceptRemote === false ? "no" : "yes")).toLowerCase().startsWith("y"),
      payEnabled,
      currency,
      floorAnnual: Number(floorAnswer) || 0,
      companyFloorAnnual: Number(companyFloorAnswer) || 0,
      fxRates: ratesAnswer ? parseRateList(ratesAnswer) : base.pay.fxRates,
      extraSeniorKeywords: await ask("Extra seniority keywords (comma; blank keeps defaults)", ""),
    };
  } finally {
    rl.close();
  }
}

async function answersFor(args, io, base, deps) {
  if (args.yes || !process.stdin.isTTY || deps.ask) {
    const ask = deps.ask ?? (async (_q, fallback) => fallback);
    return {
      siteName: await ask("Site name", base.site.name),
      tagline: await ask("Tagline", base.site.tagline),
      description: await ask("Meta description", base.site.description),
      country: args.country ?? (await ask("Home country", base.location.country ?? "")),
      countryCode: args.countryCode ?? (await ask("Country code (ISO-2)", base.location.countryCode ?? "")),
      cities: await ask("Cities (comma-separated display names; blank keeps current)", base.location.cities ?? {}),
      acceptRemote: (await ask("Keep unrestricted-remote roles (flagged verify)? (yes/no)", base.location.acceptRemote === false ? "no" : "yes")).toString().toLowerCase().startsWith("y"),
      payEnabled: (await ask("Gate roles by pay floor? (yes/no)", base.pay.enabled === false ? "no" : "yes")).toString().toLowerCase().startsWith("y"),
      currency: (await ask("Pay currency", base.pay.currency ?? "USD")).toUpperCase(),
      floorAnnual: Number(await ask("Senior base floor (annual)", base.pay.floorAnnual ?? 0)) || 0,
      companyFloorAnnual: Number(await ask("Company general floor (annual)", base.pay.companyFloorAnnual ?? 0)) || 0,
      fxRates: await ask("FX rates into the base currency", base.pay.fxRates ?? {}),
      extraSeniorKeywords: await ask("Extra seniority keywords", ""),
    };
  }
  return promptAll(io, base, args);
}

export async function runSetup(argv = process.argv.slice(2), io = console, deps = {}) {
  const args = parseArgs(argv);
  if (args.help) {
    io.log(USAGE);
    return 0;
  }
  const dataDir = args.dataDir ? pathToFileURL(`${resolve(args.dataDir)}/`) : new URL("../data/", import.meta.url);
  const read = (name, fallback) => (existsSync(new URL(name, dataDir)) ? JSON.parse(readFileSync(new URL(name, dataDir), "utf8")) : fallback);

  const rawConfig = read("config.json", {});
  const base = loadConfig(rawConfig, { env: process.env });
  const companies = read("companies.json", []);

  const answers = await answersFor(args, io, base, deps);
  if (!answers.country) {
    io.error("a home country is required — answer the prompt or pass --country");
    return 2;
  }
  // never accidentally treat an object answer (default kept) as a city list
  if (!isPlainObject(answers.cities)) answers.cities = parseCityList(answers.cities);
  if (!isPlainObject(answers.fxRates)) answers.fxRates = parseRateList(answers.fxRates);

  const overrides = buildOverrides({ base, answers });
  const nextConfig = pruneDefaults(deepMerge(rawConfig, overrides), DEFAULTS) ?? {};

  // ---- companies: keep, or import the URLs from --company ----
  let nextCompanies = [...companies];
  for (const input of args.companies) {
    const detected = detectAts(input);
    if (!detected) {
      io.error(`skipping unrecognized company URL: ${input}`);
      return 2;
    }
    if (args.verify) {
      const result = await (deps.verify ?? verifyBoard)(detected, base);
      if (!result.ok) {
        io.error(`board check failed for ${detected.ats}:${detected.slug} — ${result.error}`);
        return 1;
      }
      io.log(`board ok — ${detected.ats}:${detected.slug} (${result.count} postings)`);
    }
    const entry = buildEntry({ ats: detected.ats, slug: detected.slug });
    const { companies: merged, action } = appendCompany(nextCompanies, entry, { update: false });
    if (action === "duplicate") {
      io.log(`already tracked: ${detected.ats}:${detected.slug}`);
      continue;
    }
    nextCompanies = merged;
    io.log(`will add ${detected.ats}:${detected.slug}`);
  }

  const configErrors = validateConfig(loadConfig(nextConfig, { env: process.env })).errors;
  if (configErrors.length) {
    for (const error of configErrors) io.error(`error ${error}`);
    return 1;
  }

  if (args.dryRun) {
    io.log("config:");
    io.log(JSON.stringify(nextConfig, null, 2));
    io.log(`companies: ${nextCompanies.length}`);
    io.log("dry run (no files written)");
    return 0;
  }

  for (const name of ["config.json", "companies.json"]) {
    const file = new URL(name, dataDir);
    if (existsSync(file)) copyFileSync(file, new URL(`${name}.bak`, dataDir));
  }
  writeFileSync(new URL("config.json", dataDir), JSON.stringify(nextConfig, null, 2) + "\n");
  writeFileSync(new URL("companies.json", dataDir), JSON.stringify(nextCompanies, null, 2) + "\n");

  io.log(`wrote config.json (${answers.country}, ${answers.payEnabled ? `${answers.currency} floor ${answers.floorAnnual}/yr` : "pay gate off"})`);
  io.log(`wrote companies.json (${nextCompanies.length} companies)`);
  io.log("");
  io.log("Next:");
  io.log("  1. npm run crawl:dry      # sanity-check boards and filters");
  io.log("  2. npm run render         # preview site/ locally");
  io.log("  3. push and enable Pages: Settings → Pages → GitHub Actions");
  io.log("  4. optional: LLM_API_KEY + LLM_API_BASE_URL + LLM_MODEL for ambiguous titles");
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await runSetup();
}
