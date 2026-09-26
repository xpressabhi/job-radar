#!/usr/bin/env node
// Add a company to data/companies.json: detect the ATS from a careers URL (or take a slug
// with --ats), verify the board live, then append a validated entry.
//
// Usage: node scripts/add-company.mjs <url|slug> [options]
//   --ats <gh|lever|ashby|sr|workable>  required when passing a bare slug
//   --name "Display Name"               default: slug with words capitalized
//   --tier "big-tech"                   optional, free-form
//   --general <amount> --senior <amount>  optional pay vetting (annual, pay.currency)
//   --update                            replace an existing ats:slug entry
//   --no-verify                         skip the live board check (escape hatch)
//   --dry-run                           print the entry; write nothing
//   --data-dir <path>                   override the data directory (tests)
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { loadConfigFile } from "./lib/config.mjs";
import { createFetcher } from "./lib/fetch.mjs";
import { getAdapter } from "./sources/index.mjs";
import { validateCompanies } from "./validate-companies.mjs";

const USAGE = `Usage: node scripts/add-company.mjs <url|slug> [--ats <ats>] [--name "..."] [--tier "..."]
  [--general <amount>] [--senior <amount>] [--update] [--no-verify] [--dry-run] [--data-dir <path>]`;

const CAREERS_URL = {
  gh: (slug) => `https://job-boards.greenhouse.io/${slug}`,
  lever: (slug) => `https://jobs.lever.co/${slug}`,
  ashby: (slug) => `https://jobs.ashbyhq.com/${slug}`,
  sr: (slug) => `https://careers.smartrecruiters.com/${slug}`,
  workable: (slug) => `https://apply.workable.com/${slug}/`,
};

const firstSegment = (url) => url.pathname.split("/").filter(Boolean)[0] ?? null;

/** Detect `{ ats, slug }` from a supported careers URL; null when unrecognized. */
export function detectAts(input) {
  let url;
  try {
    url = new URL(String(input));
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  let slug = null;
  let ats = null;
  if (/(^|\.)greenhouse\.io$/.test(host)) {
    ats = "gh";
    slug = firstSegment(url);
  } else if (host === "jobs.lever.co") {
    ats = "lever";
    slug = firstSegment(url);
  } else if (host === "jobs.ashbyhq.com") {
    ats = "ashby";
    slug = firstSegment(url);
  } else if (/(^|\.)smartrecruiters\.com$/.test(host)) {
    ats = "sr";
    slug = firstSegment(url);
  } else if (/(^|\.)workable\.com$/.test(host)) {
    ats = "workable";
    const parts = url.pathname.split("/").filter(Boolean);
    slug = parts[0] === "company" ? parts[1] : parts[0];
  }
  if (!ats || !slug || !/^[A-Za-z0-9._-]+$/.test(slug)) return null;
  return { ats, slug };
}

export function parseArgs(argv) {
  const args = {
    input: null, ats: null, name: null, tier: null, general: null, senior: null,
    update: false, verify: true, dryRun: false, dataDir: null, help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--ats") args.ats = argv[++i] ?? null;
    else if (a === "--name") args.name = argv[++i] ?? null;
    else if (a === "--tier") args.tier = argv[++i] ?? null;
    else if (a === "--general") args.general = Number(argv[++i]);
    else if (a === "--senior") args.senior = Number(argv[++i]);
    else if (a === "--update") args.update = true;
    else if (a === "--no-verify") args.verify = false;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--data-dir") args.dataDir = argv[++i] ?? null;
    else if (a === "--help" || a === "-h") args.help = true;
    else if (!a.startsWith("--")) args.input = a;
  }
  return args;
}

const displayName = (slug) => slug.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export function buildEntry({ ats, slug, name, tier, general, senior, now = new Date() }) {
  const entry = {
    name: name ?? displayName(slug),
    ats,
    slug,
    careersUrl: CAREERS_URL[ats](slug),
  };
  if (tier) entry.tier = tier;
  if (Number.isFinite(general) || Number.isFinite(senior)) {
    entry.payVetting = {
      generalBaseMin: Number.isFinite(general) ? general : 0,
      seniorBaseMin: Number.isFinite(senior) ? senior : 0,
      confidence: "estimate",
      sources: [`added via add-company on ${now.toISOString().slice(0, 10)}; confirm in review`],
      verifiedOn: now.toISOString().slice(0, 10),
      notes: "Awaiting review.",
    };
  }
  entry.enabled = true;
  return entry;
}

export function appendCompany(companies, entry, { update = false } = {}) {
  const idx = companies.findIndex((c) => c.ats === entry.ats && String(c.slug).toLowerCase() === String(entry.slug).toLowerCase());
  if (idx >= 0) {
    if (!update) return { companies, action: "duplicate", existing: companies[idx] };
    const next = [...companies];
    next[idx] = entry;
    return { companies: next, action: "updated", existing: companies[idx] };
  }
  return { companies: [...companies, entry], action: "added" };
}

async function promptMissing(entry, config, io) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const name = (await rl.question(`Display name [${entry.name}]: `)).trim();
    if (name) entry.name = name;
    const tier = (await rl.question("Tier (optional, free-form): ")).trim();
    if (tier) entry.tier = tier;
    if (!entry.payVetting) {
      const want = (await rl.question("Record pay vetting now? [y/N]: ")).trim().toLowerCase();
      if (want === "y" || want === "yes") {
        const unit = config.pay?.display?.divisor ?? 1;
        const suffix = config.pay?.display?.suffix ?? "";
        const generalAnswer = Number((await rl.question(`General base min (${config.pay?.currency ?? "base"}${suffix} units, e.g. 25): `)).trim());
        const seniorAnswer = Number((await rl.question(`Senior base min (${config.pay?.currency ?? "base"}${suffix} units, e.g. 50): `)).trim());
        if (Number.isFinite(generalAnswer) || Number.isFinite(seniorAnswer)) {
          entry.payVetting = {
            generalBaseMin: Number.isFinite(generalAnswer) ? generalAnswer * unit : 0,
            seniorBaseMin: Number.isFinite(seniorAnswer) ? seniorAnswer * unit : 0,
            confidence: "estimate",
            sources: [`added via add-company on ${new Date().toISOString().slice(0, 10)}; confirm in review`],
            verifiedOn: new Date().toISOString().slice(0, 10),
            notes: "Awaiting review.",
          };
        }
      }
    }
  } finally {
    rl.close();
  }
  return entry;
}

export async function runAddCompany(argv = process.argv.slice(2), io = console, deps = {}) {
  const args = parseArgs(argv);
  if (args.help) {
    io.log(USAGE);
    return 0;
  }
  const dataDir = args.dataDir
    ? pathToFileURL(`${resolve(args.dataDir)}/`)
    : new URL("../data/", import.meta.url);
  const readData = (name, fallback) => (existsSync(new URL(name, dataDir)) ? JSON.parse(readFileSync(new URL(name, dataDir), "utf8")) : fallback);

  const detected = args.input && args.input.includes("://")
    ? detectAts(args.input)
    : args.ats && args.input
      ? { ats: args.ats, slug: args.input }
      : null;
  if (!detected) {
    io.error(`could not detect the ATS from "${args.input ?? ""}"${args.ats ? ` with --ats ${args.ats}` : ""}`);
    io.error("supported: Greenhouse, Lever, Ashby, SmartRecruiters, Workable URLs — or a bare slug with --ats");
    return 2;
  }
  if (!getAdapter(detected.ats)) {
    io.error(`no adapter for "${detected.ats}"`);
    return 2;
  }

  const config = loadConfigFile(new URL("config.json", dataDir), { env: process.env });
  const companies = readData("companies.json", []);

  if (args.verify) {
    const verify = deps.verify ?? defaultVerify;
    const result = await verify({ ...detected, name: args.name ?? displayName(detected.slug) }, config);
    if (!result.ok) {
      io.error(`board check failed for ${detected.ats}:${detected.slug} — ${result.error}`);
      return 1;
    }
    io.log(`board ok — ${result.count} posting(s)`);
  }

  let entry = buildEntry({ ats: detected.ats, slug: detected.slug, name: args.name, tier: args.tier, general: args.general, senior: args.senior });
  if (process.stdin.isTTY && !process.env.CI && args.input && !args.name) entry = await promptMissing(entry, config, io);

  const entryErrors = validateCompanies([entry], config);
  if (entryErrors.length) {
    for (const error of entryErrors) io.error(`error ${error}`);
    io.error("entry rejected — fix the flags or add the missing fields manually");
    return 1;
  }

  const { companies: next, action, existing } = appendCompany(companies, entry, { update: args.update });
  if (action === "duplicate") {
    io.error(`${entry.ats}:${entry.slug} already exists (${existing?.name}) — pass --update to replace it`);
    return 1;
  }

  if (args.dryRun) {
    io.log(`${action === "updated" ? "would update" : "would add"}:`);
    io.log(JSON.stringify(entry, null, 2));
    io.log("dry run (no files written)");
    return 0;
  }
  writeFileSync(new URL("companies.json", dataDir), JSON.stringify(next, null, 2) + "\n");
  io.log(`${action} ${entry.ats}:${entry.slug} (${entry.name}) — ${next.length} companies`);
  if (!entry.payVetting && config.pay?.vettingRequired) {
    io.log("note: pay.vettingRequired is true — validate:companies will flag this entry until vetting is added");
  }
  return 0;
}

async function defaultVerify(company, config) {
  try {
    const fetcher = createFetcher({
      userAgent: config.userAgent,
      timeoutMs: config.timeoutMs,
      retries: config.retries,
      delayMs: 0,
    });
    const adapter = getAdapter(company.ats);
    const res = await adapter.listBoard({ fetcher, company });
    if (!res.ok) return { ok: false, error: res.error ?? `HTTP ${res.status}` };
    return { ok: true, count: res.postings.length };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export { defaultVerify as verifyBoard };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await runAddCompany();
}
