#!/usr/bin/env node
// Renderer: data/jobs.json (+ health, config) → site/ (index.html, archive.html, jobs.json, feed.xml).
// Server-rendered rows (visible without JS) + progressive-enhancement filters; self-contained.
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CATEGORIES } from "./lib/taxonomy.mjs";
import { emptyStore } from "./lib/store.mjs";

const DATA = new URL("../data/", import.meta.url);
const TEMPLATES = new URL("../templates/", import.meta.url);

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function formatDay(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");

export function payLabel(pay) {
  if (!pay) return "";
  if (pay.published) {
    const min = pay.baseMinLpa;
    const max = pay.baseMaxLpa;
    const band = min && max && max !== min ? `₹${min}–${max}L` : `₹${min ?? max}L`;
    const kind = pay.totalOnly ? "total comp" : "base";
    return `${band} ${kind}${pay.totalOnly ? " · base unverified" : ""}`;
  }
  return pay.vettedSeniorMinLpa ? `vetted ≥₹${pay.vettedSeniorMinLpa}L base` : "";
}

export function locationLabel(job) {
  const cities = job.location?.cities ?? [];
  if (cities.length) return cities.join(", ");
  if (job.location?.indiaScope === "remote_india") return "Remote (India)";
  if (job.location?.indiaScope === "remote_global") return "Remote (global)";
  return "India";
}

export function jobRow(job) {
  const cities = (job.location?.cities ?? []).map((c) => c.toLowerCase()).join("|");
  const search = [job.title, job.company, ...(job.tags ?? []), ...(job.location?.cities ?? [])]
    .join(" ")
    .toLowerCase();
  const mode = job.location?.mode ?? "";
  const scope = job.location?.indiaScope ?? "";
  const pay = payLabel(job.pay);
  const modeNote = mode === "hybrid" ? " · hybrid" : mode === "remote" ? " · remote" : "";
  const badges = [
    pay ? `<span class="badge salary${job.pay?.published ? "" : " vetted"}">${esc(pay)}</span>` : "",
    scope === "remote_global" ? `<span class="badge remote-global">verify eligibility</span>` : "",
    job.seniority ? `<span class="badge seniority">${esc(capitalize(job.seniority))}${job.levelSource === "tier-assumed" ? " (assumed)" : ""}</span>` : "",
  ]
    .filter(Boolean)
    .join("\n    ");
  return `<li class="job" data-category="${esc(job.category ?? "other")}" data-cities="${esc(cities)}" data-mode="${esc(mode)}" data-scope="${esc(scope)}" data-company="${esc(job.company)}" data-seen="${esc(job.firstSeen ?? "")}" data-search="${esc(search)}">
  <div class="job-main">
    <h3><a href="${esc(job.url)}" rel="noopener">${esc(job.title)}</a></h3>
    <p class="company">${esc(job.company)} · ${esc(locationLabel(job))}${modeNote}</p>
    <div class="tags">${(job.tags ?? []).map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>
  </div>
  <div class="job-meta">
    ${badges}
    <span class="date">${job.postedAt ? `posted ${formatDay(job.postedAt)}` : `first seen ${formatDay(job.firstSeen)}`}</span>
  </div>
</li>`;
}

function archiveGroups(archived) {
  const byMonth = new Map();
  for (const job of archived) {
    const month = (job.closedAt ?? job.lastSeen ?? job.firstSeen ?? "").slice(0, 7) || "unknown";
    if (!byMonth.has(month)) byMonth.set(month, []);
    byMonth.get(month).push(job);
  }
  const groups = [...byMonth.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  return groups
    .map(([month, jobs]) => {
      const label = month === "unknown" ? "Unknown" : `${MONTHS_LONG[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
      const rows = jobs
        .map((job) => {
          const pay = payLabel(job.pay);
          return `<li class="job">
  <div class="job-main">
    <h3><a href="${esc(job.url)}" rel="noopener">${esc(job.title)}</a></h3>
    <p class="company">${esc(job.company)} · ${esc(locationLabel(job))}</p>
  </div>
  <div class="job-meta">
    ${pay ? `<span class="badge salary${job.pay?.published ? "" : " vetted"}">${esc(pay)}</span>` : ""}
    <span class="date">closed ${formatDay(job.closedAt)}</span>
  </div>
</li>`;
        })
        .join("\n");
      return `<section class="month-group">\n<h3>${esc(label)} · ${jobs.length}</h3>\n<ul class="jobs">\n${rows}\n</ul>\n</section>`;
    })
    .join("\n");
}

function coverageHtml(store, activeCount, archivedCount) {
  const run = store.lastRun ?? {};
  const total = run.boardsTotal ?? null;
  const ok = run.boardsOk ?? null;
  const failed = total !== null && ok !== null ? total - ok : null;
  const degraded = total !== null && failed !== null && failed > total / 2;
  const bits = [
    `<span><strong>${activeCount}</strong> live roles</span>`,
    `<span><strong>${archivedCount}</strong> archived</span>`,
    ok !== null && total !== null ? `<span><strong>${ok}/${total}</strong> boards scanned</span>` : "",
    run.new ? `<span><strong>+${run.new}</strong> new this run</span>` : "",
    run.archived ? `<span><strong>${run.archived}</strong> closed this run</span>` : "",
    run.dropped != null ? `<span><strong>${run.dropped}</strong> filtered out (pay/level/location)</span>` : "",
    run.droppedBelowFloor ? `<span><strong>${run.droppedBelowFloor}</strong> below the ₹50L base floor</span>` : "",
    degraded ? `<span class="warn">degraded run — archiving suspended</span>` : "",
  ].filter(Boolean);
  return bits.join("\n  ");
}

function rssFeed(active, siteUrl) {
  const items = active
    .slice(0, 50)
    .map((job) => {
      const pay = payLabel(job.pay);
      const description = [job.company, locationLabel(job), pay, job.seniority].filter(Boolean).join(" · ");
      const pub = job.postedAt ?? job.firstSeen;
      return `  <item>
    <title>${esc(job.title)} — ${esc(job.company)}</title>
    <link>${esc(job.url)}</link>
    <guid isPermaLink="true">${esc(job.url)}</guid>
    <pubDate>${pub ? new Date(pub).toUTCString() : ""}</pubDate>
    <description>${esc(description)}</description>
  </item>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>Job Radar — senior engineering roles in India</title>
  <link>${esc(siteUrl)}</link>
  <description>Senior+ engineering roles in India (or remote-India) at companies vetted to pay at least ₹50L base at senior level.</description>
  <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
</channel>
</rss>
`;
}

export function renderSite({ store, config, siteUrl = "https://xpressabhi.github.io/job-radar/", now = new Date().toISOString() }) {
  const jobs = store.jobs ?? [];
  const active = jobs
    .filter((j) => j.status === "active")
    .sort((a, b) => String(b.firstSeen).localeCompare(String(a.firstSeen)));
  const archived = jobs
    .filter((j) => j.status === "archived")
    .sort((a, b) => String(b.closedAt ?? "").localeCompare(String(a.closedAt ?? "")));

  const style = readFileSync(new URL("style.css", TEMPLATES), "utf8");
  const script = readFileSync(new URL("app.js", TEMPLATES), "utf8");
  const indexTemplate = readFileSync(new URL("index.html", TEMPLATES), "utf8");
  const archiveTemplate = readFileSync(new URL("archive.html", TEMPLATES), "utf8");

  const rows = active.map(jobRow).join("\n");
  const categoryOptions = CATEGORIES.filter((c) => c !== "other")
    .map((c) => `<option value="${esc(c)}">${esc(capitalize(c.replace("-", " ")))}</option>`)
    .join("");
  const coverage = coverageHtml(store, active.length, archived.length);

  const index = indexTemplate
    .replace("{{STYLE}}", style)
    .replace("{{SCRIPT}}", script)
    .replace("{{CATEGORY_OPTIONS}}", categoryOptions)
    .replace("{{ROWS}}", rows || `<li class="empty">No live roles right now — check the archive or the RSS feed.</li>`)
    .replace("{{COVERAGE}}", coverage)
    .replace("{{ARCHIVE_COUNT}}", String(archived.length))
    .replace("{{UPDATED}}", `${formatDay(now)} ${now.slice(11, 16)} UTC`)
    .replace("{{DATA}}", JSON.stringify(active));

  const archive = archiveTemplate
    .replace("{{STYLE}}", style)
    .replace("{{GROUPS}}", archiveGroups(archived) || `<p class="empty">Nothing archived yet.</p>`)
    .replace("{{COVERAGE}}", coverage)
    .replace("{{ARCHIVE_COUNT}}", String(archived.length))
    .replace("{{UPDATED}}", `${formatDay(now)} ${now.slice(11, 16)} UTC`);

  return {
    "index.html": index,
    "archive.html": archive,
    "jobs.json": JSON.stringify(store, null, 2) + "\n",
    "feed.xml": rssFeed(active, siteUrl),
  };
}

async function main() {
  const data = (name, fallback) => {
    const url = new URL(name, DATA);
    return existsSync(url) ? JSON.parse(readFileSync(url, "utf8")) : fallback;
  };
  const store = data("jobs.json", emptyStore());
  const config = data("config.json", {});
  const files = renderSite({ store, config });

  const outDir = new URL("../site/", import.meta.url);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(new URL(name, outDir), content);
  }
  const active = store.jobs.filter((j) => j.status === "active").length;
  const archived = store.jobs.filter((j) => j.status === "archived").length;
  console.log(`rendered site/: ${active} active, ${archived} archived → ${fileURLToPath(outDir)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
