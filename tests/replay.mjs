#!/usr/bin/env node
// Offline replay: trimmed real board payloads run through the full pipeline
// (adapter → filters → store merge) and diffed against tests/golden/store.json.
// A rule change that alters output fails here until `--update-golden` is run.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { getAdapter } from "../scripts/sources/index.mjs";
import { applyFilters } from "../scripts/lib/filters.mjs";
import { applyClassification } from "../scripts/lib/taxonomy.mjs";
import { emptyStore, mergeResults } from "../scripts/lib/store.mjs";
import { loadConfigFile } from "../scripts/lib/config.mjs";

const NOW = "2026-09-26T02:00:00.000Z";
const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
// Pinned so repo config edits (fork personalization) can never change replay output.
const config = loadConfigFile(new URL("./fixtures/config.json", import.meta.url));

const companies = {
  groww: { name: "Groww", slug: "groww", ats: "gh", tier: "india-product", payVetting: { seniorBaseMin: 5500000 } },
  meesho: { name: "Meesho", slug: "meesho", ats: "lever", tier: "india-product", payVetting: { seniorBaseMin: 6000000 } },
  cohere: { name: "Cohere", slug: "cohere", ats: "ashby", tier: "frontier-ai", payVetting: { seniorBaseMin: 7000000 } },
  Freshworks: { name: "Freshworks", slug: "Freshworks", ats: "sr", tier: "india-product", payVetting: { seniorBaseMin: 5500000 } },
  huggingface: { name: "Hugging Face", slug: "huggingface", ats: "workable", tier: "remote-first", payVetting: { seniorBaseMin: 6000000 } },
};

const fetchers = {
  gh: async () => ({ ok: true, status: 200, data: fixture("greenhouse-list.json") }),
  lever: async () => ({ ok: true, status: 200, data: fixture("lever-list.json") }),
  ashby: async () => ({ ok: true, status: 200, data: fixture("ashby-list.json") }),
  sr: async (url) => ({
    ok: true,
    status: 200,
    data: url.includes("offset=100") ? fixture("sr-page2.json") : fixture("sr-page1.json"),
  }),
  workable: async () => ({ ok: true, status: 200, data: fixture("workable-list.json") }),
};

export async function replay() {
  const results = [];
  for (const company of Object.values(companies)) {
    const adapter = getAdapter(company.ats);
    const fetcher = { getJson: (url) => fetchers[company.ats](url) };
    const board = await adapter.listBoard({ fetcher, company });
    if (!board.ok) throw new Error(`replay fetch failed for ${company.name}: ${board.error}`);
    const kept = [];
    for (const posting of board.postings) {
      const res = applyFilters({ posting, company, config });
      if (res.keep) kept.push(res.posting);
    }
    const { classified } = applyClassification(kept, {}, config.location);
    results.push({ ok: true, company: company.name, companySlug: company.slug, source: company.ats, rawCount: board.postings.length, postings: classified });
  }

  const { store, summary } = mergeResults({ store: emptyStore(), results, config, now: NOW });
  store.jobs.sort((a, b) => a.id.localeCompare(b.id));
  return { store, summary };
}

const goldenPath = new URL("./golden/store.json", import.meta.url);

async function main() {
  const update = process.argv.includes("--update-golden");
  const { store, summary } = await replay();
  const rendered = JSON.stringify(store, null, 2) + "\n";

  if (update) {
    writeFileSync(goldenPath, rendered);
    console.log(`golden updated: ${store.jobs.length} jobs (kept ${summary.seen} of raw boards)`);
    return 0;
  }

  if (!existsSync(goldenPath)) {
    console.error("no golden file — run `npm run replay -- --update-golden` once and commit it");
    return 1;
  }
  const golden = readFileSync(goldenPath, "utf8");
  if (golden === rendered) {
    console.log(`replay ok: ${store.jobs.length} jobs match the golden store`);
    return 0;
  }

  const goldJobs = JSON.parse(golden).jobs ?? [];
  const nowJobs = store.jobs;
  const goldIds = new Set(goldJobs.map((j) => j.id));
  const nowIds = new Set(nowJobs.map((j) => j.id));
  const added = nowJobs.filter((j) => !goldIds.has(j.id)).map((j) => j.id);
  const removed = goldJobs.filter((j) => !nowIds.has(j.id)).map((j) => j.id);
  const changed = nowJobs
    .filter((j) => goldIds.has(j.id) && JSON.stringify(j) !== JSON.stringify(goldJobs.find((g) => g.id === j.id)))
    .map((j) => j.id);
  console.error("replay mismatch — output differs from the golden store:");
  if (added.length) console.error(`  added:   ${added.join(", ")}`);
  if (removed.length) console.error(`  removed: ${removed.join(", ")}`);
  if (changed.length) console.error(`  changed: ${changed.join(", ")}`);
  console.error("if the change is intended, run `npm run replay -- --update-golden` and commit the result");
  return 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await main();
}
