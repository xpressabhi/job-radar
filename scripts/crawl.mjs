#!/usr/bin/env node
// Crawl orchestrator: fetch boards → detail for passers → filter → classify → merge store
// → archive → evidence/health → write data. `--dry-run` writes nothing.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createFetcher } from "./lib/fetch.mjs";
import { loadConfig } from "./lib/config.mjs";
import { formatBand, formatMoney } from "./lib/money.mjs";
import { locationScope, payMax, payMin, payVetted } from "./lib/accessors.mjs";
import { getAdapter } from "./sources/index.mjs";
import { applyFilters, classifyGeography, classifySeniority, isEngineeringTitle } from "./lib/filters.mjs";
import { cleanTitle } from "./lib/normalize.mjs";
import { emptyStore, mergeResults, appendCompEvidence, updateHealth, runSummaryLine } from "./lib/store.mjs";
import { classifyBatch } from "./lib/llm.mjs";
import { loadCache, saveCache, applyClassification } from "./lib/taxonomy.mjs";

const DATA = new URL("../data/", import.meta.url);
const DETAIL_CAP = 150;

const USAGE = `Usage: node scripts/crawl.mjs [--dry-run] [--company <name|slug>] [--limit N] [--no-detail]

  --dry-run          fetch + filter + merge in memory; write nothing
  --company <x>      only this company (case-insensitive name or slug)
  --limit N          kept postings to print in dry-run (default 10)
  --no-detail        skip per-job detail fetches (descriptions/pay)
`;

export function parseArgs(argv) {
  const args = { dryRun: false, company: null, limit: 10, detail: true, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--company") args.company = argv[++i] ?? null;
    else if (a === "--limit") args.limit = Number(argv[++i] ?? 10);
    else if (a === "--no-detail") args.detail = false;
    else if (a === "--help" || a === "-h") args.help = true;
  }
  return args;
}

const readData = (name, fallback) => {
  const url = new URL(name, DATA);
  return existsSync(url) ? JSON.parse(readFileSync(url, "utf8")) : fallback;
};
const writeData = (name, value) => writeFileSync(new URL(name, DATA), JSON.stringify(value, null, 2) + "\n");

function passesBeforePay(posting, company, config) {
  const title = cleanTitle(posting.title, config.location);
  if (!isEngineeringTitle(title)) return false;
  if (!classifySeniority(title, company.tier, config).keep) return false;
  return classifyGeography(posting, config).keep;
}

export async function main(argv = process.argv.slice(2), io = console, env = process.env) {
  const args = parseArgs(argv);
  if (args.help) {
    io.log(USAGE);
    return 0;
  }
  const config = loadConfig(readData("config.json", {}), { env });
  const companies = readData("companies.json");

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

  let detailFetches = 0;
  const results = [];
  for (const company of selected) {
    const adapter = getAdapter(company.ats);
    if (!adapter) {
      results.push({ ok: false, company: company.name, companySlug: company.slug, source: company.ats, error: `no adapter for "${company.ats}"` });
      io.log(`SKIP  ${company.name} — no adapter for "${company.ats}"`);
      continue;
    }
    const res = await adapter.listBoard({ fetcher, company });
    if (!res.ok) {
      results.push({ ok: false, company: company.name, companySlug: company.slug, source: company.ats, error: res.error ?? `HTTP ${res.status}` });
      io.log(`FAIL  ${company.name} (${company.ats}:${company.slug}) — ${res.error ?? `HTTP ${res.status}`}`);
      continue;
    }

    const postings = res.postings;
    if (args.detail && typeof adapter.fetchJobDetail === "function") {
      for (const posting of postings) {
        if (detailFetches >= DETAIL_CAP) break;
        if (!passesBeforePay(posting, company, config)) continue;
        detailFetches++;
        const detail = await adapter.fetchJobDetail({ fetcher, company, jobId: posting.jobId });
        if (detail.ok) {
          if (detail.description) posting.description = detail.description;
          if (detail.postedAt) posting.postedAt = detail.postedAt;
          if (detail.payInputRanges) posting.payInputRanges = detail.payInputRanges;
        }
      }
    }

    io.log(`OK    ${company.name} (${company.ats}:${company.slug}) — ${postings.length}/${res.total} postings`);
    results.push({ ok: true, company: company.name, companySlug: company.slug, source: company.ats, rawCount: postings.length, postings: postings.map((p, i) => ({ ...p, _company: company, _index: i })) });
  }

  // ---- Filters + classification ----
  const dropReasons = new Map();
  const belowFloor = [];
  const resultsFiltered = [];
  let rawTotal = 0;
  let keptTotal = 0;

  for (const result of results) {
    if (!result.ok) {
      resultsFiltered.push(result);
      continue;
    }
    const kept = [];
    for (const posting of result.postings) {
      const { _company: company, _index, ...clean } = posting;
      rawTotal++;
      const res = applyFilters({ posting: clean, company, config });
      if (res.keep) {
        kept.push(res.posting);
      } else {
        const reason = res.drops[0];
        dropReasons.set(reason, (dropReasons.get(reason) ?? 0) + 1);
        if (reason.startsWith("pay below floor")) belowFloor.push(`${company.name}: ${clean.title}`);
      }
    }
    keptTotal += kept.length;
    resultsFiltered.push({ ...result, postings: kept });
  }

  // ---- Classification (rules + cached LLM fallback) ----
  const cache = loadCache(readData("llm-cache.json", {}));
  const keptPostings = resultsFiltered.filter((r) => r.ok).flatMap((r) => r.postings);
  const { classified } = applyClassification(keptPostings, cache, config.location);
  const pendingTitles = [];
  for (const p of classified) {
    if (p.needsClassify && !pendingTitles.includes(p.title)) pendingTitles.push(p.title);
  }
  if (pendingTitles.length && !args.dryRun) {
    const llmResult = await classifyBatch({
      titles: pendingTitles.slice(0, config.llm?.maxPerRun ?? 40),
      apiKey: env.LLM_API_KEY,
      baseUrl: env.LLM_API_BASE_URL,
      model: env.LLM_MODEL,
    });
    if (llmResult.ok) {
      for (const item of llmResult.items) {
        saveCache(cache, item.title, "", { category: item.category, tags: item.tags }, config.location);
      }
      // Re-apply with the fresh cache entries.
      const second = applyClassification(keptPostings, cache, config.location);
      classified.length = 0;
      classified.push(...second.classified);
    } else {
      io.log(`LLM fallback unavailable (${llmResult.error}) — ${pendingTitles.length} titles queued for next run`);
    }
  }
  const classifiedById = new Map(classified.map((p) => [p.dedupeKey, p]));
  for (const result of resultsFiltered) {
    if (!result.ok) continue;
    result.postings = result.postings.map((p) => classifiedById.get(p.dedupeKey) ?? p);
  }

  // ---- Merge / archive / evidence / health ----
  const now = new Date().toISOString();
  const store = readData("jobs.json", emptyStore());
  const failed = results.filter((r) => !r.ok).length;
  const degraded = failed > selected.length / 2;
  const { summary } = mergeResults({
    store,
    results: resultsFiltered,
    config,
    now,
    archive: !degraded,
  });
  const keptAll = resultsFiltered.filter((r) => r.ok).flatMap((r) => r.postings);
  const { evidence, added: evidenceAdded } = appendCompEvidence(readData("comp-evidence.json", []), keptAll, now);
  const health = updateHealth(readData("health.json", {}), results, now);
  store.lastRun = {
    ...(store.lastRun ?? {}),
    boardsTotal: selected.length,
    dropped: rawTotal - keptTotal,
    droppedBelowFloor: belowFloor.length,
    detailFetches,
    evidenceAdded,
  };

  const dropTop = [...dropReasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  io.log(`\nboards ok ${summary.boardsOk}/${selected.length} · raw ${rawTotal} · kept ${keptTotal} · new ${summary.new} · archived ${summary.archived} · reopened ${summary.reopened} · duplicates ${summary.duplicates}`);
  for (const [reason, count] of dropTop) io.log(`   drop ${String(count).padStart(4)} × ${reason}`);
  if (belowFloor.length) io.log(`   ${belowFloor.length} roles dropped below pay floor (lower bound < ${formatMoney(config.pay.floorAnnual, config.pay.display)} base)`);
  io.log(`   comp evidence +${evidenceAdded} · classification pending ${classified.filter((p) => p.needsClassify).length}${cache ? "" : ""}`);
  if (degraded) io.log(`   DEGRADED RUN (>${Math.floor(selected.length / 2)} boards failed) — archiving suspended`);

  if (args.dryRun) {
    io.log(`\nkept postings (first ${args.limit}):`);
    for (const p of keptAll.slice(0, args.limit)) {
      const pay = p.pay?.published
        ? `pay ${formatBand(payMin(p.pay), payMax(p.pay), config.pay.display)}${p.pay.totalOnly ? " total" : ""}`
        : `vetted ${formatMoney(payVetted(p.pay), config.pay.display)}`;
      io.log(`   ${p.title} — ${p.company} — ${p.location.cities.join("/") || locationScope(p.location)} — ${p.category} — ${p.seniority} — ${pay}`);
    }
    io.log("\ndry run (no files written)");
    return summary.boardsOk === 0 ? 1 : 0;
  }

  writeData("jobs.json", store);
  writeData("comp-evidence.json", evidence);
  writeData("health.json", health);
  writeData("llm-cache.json", cache);
  io.log(`\n${runSummaryLine(summary, selected.length, now.slice(0, 10))}`);
  return summary.boardsOk === 0 ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
