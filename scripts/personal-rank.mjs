#!/usr/bin/env node
// Local-only personal shortlist. Never runs in CI; writes only under output/.
// Ranks active jobs from data/jobs.json against a profile file using deterministic
// keyword/prior scoring. The Jev-based eligibility + fit pass from the design (spec §14)
// is a follow-up: it needs TYPESAFE_API_KEY and a confirmed judge interface, and this
// script's output is exactly the candidate set it would consume.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { loadConfigFile } from "./lib/config.mjs";
import { formatBand, formatMoney } from "./lib/money.mjs";
import { locationScope, payMax, payMin, payVetted } from "./lib/accessors.mjs";

export function profileKeywords(profile) {
  const parts = [];
  for (const list of Object.values(profile?.skills ?? {})) {
    if (Array.isArray(list)) parts.push(...list);
  }
  for (const exp of profile?.experience ?? []) parts.push(...(exp.stack ?? []));
  for (const card of profile?.capabilityCards ?? []) parts.push(...(card.tags ?? []));
  const joined = [parts.join(" "), profile?.basics?.headline ?? ""].join(" ").toLowerCase();
  return [...new Set(joined.split(/[^a-z0-9+#.]+/).filter((t) => t.length > 2))];
}

const CATEGORY_PRIORS = { "ai-ml": 3, backend: 2, frontend: 2, fullstack: 1, "platform-infra": 1, data: 1 };

export function scoreJob(job, profile, keywords) {
  const hay = `${job.title} ${(job.tags ?? []).join(" ")} ${job.category}`.toLowerCase();
  const matches = keywords.filter((k) => hay.includes(k));
  let score = matches.length;
  score += CATEGORY_PRIORS[job.category] ?? 0;
  const home = String(profile?.basics?.location ?? "").split(",")[0].trim().toLowerCase();
  const cities = (job.location?.cities ?? []).map((c) => c.toLowerCase());
  if (home && cities.includes(home)) score += 4;
  if (locationScope(job.location) === "remote_home") score += 2;
  if (job.pay?.published) score += 1;
  return { score, matches: matches.slice(0, 8) };
}

export function shortlist({ jobs, profile, limit = 40 }) {
  const keywords = profileKeywords(profile);
  return jobs
    .filter((j) => j.status === "active")
    .map((job) => ({ job, ...scoreJob(job, profile, keywords) }))
    .sort((a, b) => b.score - a.score || String(b.job.firstSeen).localeCompare(String(a.job.firstSeen)))
    .slice(0, limit);
}

const payText = (pay, display = {}) => {
  if (pay?.published) {
    const band = formatBand(payMin(pay), payMax(pay), display);
    return `${band}${pay.totalOnly ? " total" : " base"}`;
  }
  const vetted = payVetted(pay);
  return vetted ? `vetted ≥${formatMoney(vetted, display)} base` : "";
};

export function renderMarkdown(rows, now, payDisplay = {}) {
  const lines = [
    "# Personal shortlist",
    "",
    `Generated ${now} from \`data/jobs.json\` — deterministic scoring (keywords, category priors, home city, remote-India, published pay).`,
    "Jev-based eligibility/fit judgments are the documented next step (spec §14).",
    "",
    "| # | Role | Company | Location | Pay | Category | Why |",
    "|---|---|---|---|---|---|---|",
  ];
  rows.forEach(({ job, matches }, i) => {
    const where = job.location?.cities?.join(", ") || locationScope(job.location) || "";
    lines.push(
      `| ${i + 1} | [${job.title}](${job.url}) | ${job.company} | ${where} | ${payText(job.pay, payDisplay)} | ${job.category} | ${matches.join(", ") || "—"} |`,
    );
  });
  lines.push("");
  return lines.join("\n");
}

function parseArgs(argv) {
  const args = { profile: process.env.JOB_RADAR_PROFILE ?? null, jobs: "data/jobs.json", config: "data/config.json", out: "output/personal-shortlist.md", limit: 40 };
  for (const a of argv) {
    const [key, value] = a.split("=");
    if (key === "--profile") args.profile = value;
    else if (key === "--jobs") args.jobs = value;
    else if (key === "--config") args.config = value;
    else if (key === "--out") args.out = value;
    else if (key === "--limit") args.limit = Number(value);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.profile) {
    console.error("usage: node scripts/personal-rank.mjs --profile=<profile.json> [--jobs=...] [--out=...] [--limit=N]");
    console.error("(the profile is never copied anywhere; only job data is written to the output file)");
    return 2;
  }
  const profile = JSON.parse(readFileSync(args.profile, "utf8"));
  const store = JSON.parse(readFileSync(args.jobs, "utf8"));
  const config = loadConfigFile(args.config, { env: process.env });
  const rows = shortlist({ jobs: store.jobs ?? [], profile, limit: args.limit });
  const now = new Date().toISOString();
  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, renderMarkdown(rows, now, config.pay.display));
  console.log(`shortlist: ${rows.length} roles → ${args.out}`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await main();
}
