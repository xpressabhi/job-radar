#!/usr/bin/env node
// Crawl orchestrator (skeleton). T3: fetch boards + print. Filters (T6) and store merge (T7)
// slot in after the adapter return values.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createFetcher } from "./lib/fetch.mjs";
import { getAdapter } from "./sources/index.mjs";

const USAGE = `Usage: node scripts/crawl.mjs [--dry-run] [--company <name|slug>] [--limit N]

  --dry-run          print normalized postings, write nothing (default for now)
  --company <x>      only this company (case-insensitive name or slug)
  --limit N          postings to print per company in dry-run (default 5)
`;

export function parseArgs(argv) {
  const args = { dryRun: false, company: null, limit: 5, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--company") args.company = argv[++i] ?? null;
    else if (a === "--limit") args.limit = Number(argv[++i] ?? 5);
    else if (a === "--help" || a === "-h") args.help = true;
  }
  return args;
}

export async function main(argv = process.argv.slice(2), io = console) {
  const args = parseArgs(argv);
  if (args.help) {
    io.log(USAGE);
    return 0;
  }
  const config = JSON.parse(readFileSync(new URL("../data/config.json", import.meta.url), "utf8"));
  const companies = JSON.parse(readFileSync(new URL("../data/companies.json", import.meta.url), "utf8"));

  let selected = companies.filter((c) => c.enabled);
  if (args.company) {
    const needle = args.company.toLowerCase();
    selected = selected.filter((c) => c.name.toLowerCase() === needle || c.slug.toLowerCase() === needle);
  }
  if (selected.length === 0) {
    io.error(`no companies matched${args.company ? ` "${args.company}"` : ""}`);
    return 2;
  }

  const fetcher = createFetcher({
    userAgent: config.userAgent,
    timeoutMs: config.timeoutMs,
    retries: config.retries,
    delayMs: config.requestDelayMs,
  });

  let okCompanies = 0;
  let failed = 0;
  let postings = 0;

  for (const company of selected) {
    const adapter = getAdapter(company.ats);
    if (!adapter) {
      io.log(`SKIP  ${company.name} — no adapter for "${company.ats}"`);
      failed++;
      continue;
    }
    const res = await adapter.listBoard({ fetcher, company });
    if (!res.ok) {
      io.log(`FAIL  ${company.name} (${company.ats}:${company.slug}) — ${res.error ?? `HTTP ${res.status}`}`);
      failed++;
      continue;
    }
    okCompanies++;
    postings += res.postings.length;
    io.log(
      `OK    ${company.name} (${company.ats}:${company.slug}) — ${res.postings.length}/${res.total} postings` +
        (args.dryRun ? "" : " (store merge lands in T7)"),
    );
    if (args.dryRun) {
      for (const p of res.postings.slice(0, args.limit)) {
        io.log(`        ${p.title} — ${p.locationRaw || "location not listed"}`);
      }
    }
  }

  io.log(
    `\nboards ok ${okCompanies}/${selected.length} · postings seen ${postings} · failed ${failed}` +
      (args.dryRun ? " · dry run (no files written)" : ""),
  );
  return okCompanies === 0 ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
