#!/usr/bin/env node
// Human-run board health check over the whole company universe.
// STATUS: ok | empty | blocked (403/406/429/5xx/timeout) | dead (404) | error
import { readFileSync } from "node:fs";
import { createFetcher } from "./lib/fetch.mjs";
import { loadConfigFile } from "./lib/config.mjs";
import { getAdapter } from "./sources/index.mjs";

const BLOCKED = new Set([401, 403, 406, 429]);

export function classifyBoardResult(res, error) {
  if (res?.ok) return res.postings.length > 0 ? { status: "ok", detail: `${res.postings.length} postings` } : { status: "empty", detail: "board returned no postings" };
  const status = res?.status ?? 0;
  if (status === 404) return { status: "dead", detail: "404 — slug moved or board gone" };
  if (status === 0) return { status: "blocked", detail: error ?? "network error" };
  if (BLOCKED.has(status) || status >= 500) return { status: "blocked", detail: `HTTP ${status}` };
  return { status: "error", detail: `HTTP ${status}` };
}

async function main() {
  const config = loadConfigFile(new URL("../data/config.json", import.meta.url), { env: process.env });
  const companies = JSON.parse(readFileSync(new URL("../data/companies.json", import.meta.url), "utf8"));
  const only = process.argv.find((a) => a.startsWith("--company="))?.split("=")[1];
  const selected = companies.filter((c) => c.enabled && (!only || c.name.toLowerCase() === only.toLowerCase() || c.slug === only));

  const fetcher = createFetcher({
    userAgent: config.userAgent,
    timeoutMs: config.timeoutMs,
    retries: config.retries,
    delayMs: config.requestDelayMs,
  });

  let dead = 0;
  let ok = 0;
  for (const company of selected) {
    const adapter = getAdapter(company.ats);
    if (!adapter) {
      console.log(`SKIP     ${company.name} (${company.ats}:${company.slug}) — no adapter`);
      continue;
    }
    const res = await adapter.listBoard({ fetcher, company });
    const { status, detail } = classifyBoardResult(res, res.error);
    if (status === "dead") dead++;
    if (status === "ok") ok++;
    console.log(`${status.toUpperCase().padEnd(8)} ${company.name} (${company.ats}:${company.slug}) — ${detail}`);
  }
  console.log(`\n${ok}/${selected.length} ok · ${dead} dead`);
  return dead > 0 ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await main();
}
