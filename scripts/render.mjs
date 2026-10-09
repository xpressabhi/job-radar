#!/usr/bin/env node
// Renderer: data/jobs.json (+ health, config) → site/ (index.html, archive.html, jobs.json, feed.xml).
// Server-rendered rows (visible without JS) + progressive-enhancement filters; self-contained.
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CATEGORIES } from "./lib/taxonomy.mjs";
import { emptyStore } from "./lib/store.mjs";
import { loadConfig, resolveRepo, resolveSiteUrl, detectGitRemote } from "./lib/config.mjs";
import { formatBand, formatMoney } from "./lib/money.mjs";
import { payMax, payMin, payVetted, locationScope } from "./lib/accessors.mjs";

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

const DEFAULT_PAY_DISPLAY = { symbol: "", divisor: 1, suffix: "", decimals: 0 };

export function payLabel(pay, payConfig = {}) {
  const display = payConfig.display ?? DEFAULT_PAY_DISPLAY;
  if (!pay) return "";
  if (pay.published) {
    const band = formatBand(payMin(pay), payMax(pay), display);
    const kind = pay.totalOnly ? "total comp" : "base";
    return `${band} ${kind}${pay.totalOnly ? " · base unverified" : ""}`;
  }
  const vetted = payVetted(pay);
  return vetted ? `vetted ≥${formatMoney(vetted, display)} base` : "";
}

export function locationLabel(job) {
  const cities = job.location?.cities ?? [];
  if (cities.length) return cities.join(", ");
  const scope = locationScope(job.location);
  if (scope === "remote_home") return "Remote (India)";
  if (scope === "remote_global") return "Remote (global)";
  return "India";
}

export function jobRow(job, config = {}) {
  const cities = (job.location?.cities ?? []).map((c) => c.toLowerCase()).join("|");
  const search = [job.title, job.company, ...(job.tags ?? []), ...(job.location?.cities ?? [])]
    .join(" ")
    .toLowerCase();
  const mode = job.location?.mode ?? "";
  const scope = locationScope(job.location) ?? "";
  const pay = payLabel(job.pay, config.pay);
  const modeNote = mode === "hybrid" ? " · hybrid" : mode === "remote" ? " · remote" : "";
  const badges = [
    pay ? `<span class="badge salary${job.pay?.published ? "" : " vetted"}">${esc(pay)}</span>` : "",
    scope === "remote_global" ? `<span class="badge remote-global">verify eligibility</span>` : "",
    job.seniority ? `<span class="badge seniority">${esc(capitalize(job.seniority))}${job.levelSource === "tier-assumed" ? " (assumed)" : ""}</span>` : "",
  ]
    .filter(Boolean)
    .join("\n    ");
  return `<li class="job" data-category="${esc(job.category ?? "other")}" data-cities="${esc(cities)}" data-mode="${esc(mode)}" data-scope="${esc(scope)}" data-company="${esc(job.company)}" data-fresh="${esc(job.postedAt || job.firstSeen || "")}" data-search="${esc(search)}">
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

function archiveGroups(archived, config = {}) {
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
          const pay = payLabel(job.pay, config.pay);
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

// ---------- site branding (config-driven; per-fork URLs) ----------

export function siteText(config = {}, repo = null) {
  const site = config.site ?? {};
  const name = site.name ?? "Job Radar";
  const fallbackTitle = [name, site.tagline ?? site.description ?? ""].filter(Boolean).join(" — ");
  return {
    name,
    title: site.title ?? fallbackTitle,
    tagline: site.tagline ?? "",
    description: site.description ?? "",
    sourceNote: repo
      ? `Built by <a href="${esc(`https://github.com/${repo}`)}">${esc(repo)}</a> with no runtime dependencies and no secrets.`
      : "Built with no runtime dependencies and no secrets.",
    sourceLink: repo ? ` · <a href="${esc(`https://github.com/${repo}`)}">source</a>` : "",
  };
}

/** About bullets: `site.about` (raw HTML) wins; otherwise generated from the effective config. */
export function aboutItems(config = {}) {
  const site = config.site ?? {};
  if (Array.isArray(site.about) && site.about.length) {
    return site.about.map((item) => `<li>${item}</li>`).join("\n    ");
  }
  const loc = config.location ?? {};
  const pay = config.pay ?? {};
  const country = loc.country ?? "your region";
  const items = [];
  if (pay.enabled !== false) {
    const senior = formatMoney(pay.floorAnnual, pay.display ?? DEFAULT_PAY_DISPLAY);
    const general = formatMoney(pay.companyFloorAnnual, pay.display ?? DEFAULT_PAY_DISPLAY);
    items.push(
      `<strong>Companies:</strong> a curated list; where vetting is recorded, employers must clear ${general} base generally and ${senior} base at senior level${loc.country ? ` in ${esc(loc.country)}` : ""}.`,
    );
    items.push(
      `<strong>Roles:</strong> senior+ engineering titles. Where pay is published, the band's <em>lower bound</em> must clear ${senior} base; equity and bonus never count. Where pay is not published, the company's vetted band applies when one is recorded.`,
    );
  } else {
    items.push("<strong>Companies:</strong> a curated list of employers.");
    items.push("<strong>Roles:</strong> senior+ engineering titles (pay is not gated in this instance).");
  }
  items.push(
    `<strong>Geography:</strong> ${esc(country)}-located${
      loc.acceptRemote !== false ? `, remote-${esc(country)}, and unrestricted-remote roles (the latter flagged "verify eligibility")` : ""
    }. Roles restricted to other regions are excluded.`,
  );
  items.push(
    "<strong>Freshness:</strong> crawled daily from public ATS boards. A role leaves the active list after two consecutive successful crawls without it, and lives on in the archive. Failed crawls never remove anything.",
  );
  return items.map((item) => `<li>${item}</li>`).join("\n    ");
}

/**
 * Footer cross-link bar: `site.projectsLabel` (e.g. "More by …") followed by `site.projects`
 * links. Unset projects → empty string, so forks render no upstream owner URLs.
 * An entry without `href` marks the current site (rendered as plain text).
 */
export function projectsBar(config = {}) {
  const site = config.site ?? {};
  const projects = Array.isArray(site.projects) ? site.projects : [];
  if (!projects.length) return "";
  const links = projects
    .map((p) =>
      p.href
        ? `<a href="${esc(p.href)}" style="color:var(--accent, inherit)">${esc(p.label)}</a>`
        : `<span aria-current="page">${esc(p.label)}</span>`,
    )
    .join(" · ");
  const label = typeof site.projectsLabel === "string" ? `${esc(site.projectsLabel)} · ` : "";
  return `<p class="projects-bar">${label}${links}</p>`;
}

function coverageHtml(store, activeCount, archivedCount, config = {}) {
  const run = store.lastRun ?? {};
  const total = run.boardsTotal ?? null;
  const ok = run.boardsOk ?? null;
  const failed = total !== null && ok !== null ? total - ok : null;
  const degraded = total !== null && failed !== null && failed > total / 2;
  const floorText = formatMoney(config.pay?.floorAnnual, config.pay?.display ?? DEFAULT_PAY_DISPLAY);
  const bits = [
    `<span><strong>${activeCount}</strong> live roles</span>`,
    `<span><strong>${archivedCount}</strong> archived</span>`,
    ok !== null && total !== null ? `<span><strong>${ok}/${total}</strong> boards scanned</span>` : "",
    run.new ? `<span><strong>+${run.new}</strong> new this run</span>` : "",
    run.archived ? `<span><strong>${run.archived}</strong> closed this run</span>` : "",
    run.dropped != null ? `<span><strong>${run.dropped}</strong> filtered out (pay/level/location)</span>` : "",
    run.droppedBelowFloor ? `<span><strong>${run.droppedBelowFloor}</strong> below the ${esc(floorText)} base floor</span>` : "",
    degraded ? `<span class="warn">degraded run — archiving suspended</span>` : "",
  ].filter(Boolean);
  return bits.join("\n  ");
}

function rssFeed(active, siteUrl, config = {}, site = {}) {
  const items = active
    .slice(0, 50)
    .map((job) => {
      const pay = payLabel(job.pay, config.pay);
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
  <title>${esc(site.title ?? "Job Radar")}</title>
  ${siteUrl ? `<link>${esc(siteUrl)}</link>` : ""}
  <description>${esc(site.description ?? "")}</description>
  <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
</channel>
</rss>
`;
}

export function renderSite({ store, config, siteUrl = null, repo = null, now = new Date().toISOString() }) {
  const site = siteText(config, repo);
  const jobs = store.jobs ?? [];
  const freshest = (j) => (j.postedAt || j.firstSeen || "").slice(0, 10);
  const active = jobs
    .filter((j) => j.status === "active")
    .sort((a, b) => freshest(b).localeCompare(freshest(a)) || String(b.firstSeen ?? "").localeCompare(String(a.firstSeen ?? "")));
  const archived = jobs
    .filter((j) => j.status === "archived")
    .sort((a, b) => String(b.closedAt ?? "").localeCompare(String(a.closedAt ?? "")));

  const style = readFileSync(new URL("style.css", TEMPLATES), "utf8");
  const script = readFileSync(new URL("app.js", TEMPLATES), "utf8");
  const indexTemplate = readFileSync(new URL("index.html", TEMPLATES), "utf8");
  const archiveTemplate = readFileSync(new URL("archive.html", TEMPLATES), "utf8");

  const rows = active.map((job) => jobRow(job, config)).join("\n");
  const categoryOptions = CATEGORIES.map(
    (c) => `<option value="${esc(c)}">${esc(c === "other" ? "Other / uncategorized" : capitalize(c.replace("-", " ")))}</option>`,
  ).join("");
  const coverage = coverageHtml(store, active.length, archived.length, config);

  const index = indexTemplate
    .replace("{{STYLE}}", style)
    .replace("{{SCRIPT}}", script)
    .replace("{{SITE_TITLE}}", esc(site.title))
    .replace("{{SITE_DESCRIPTION}}", esc(site.description))
    .replace("{{SITE_NAME}}", esc(site.name))
    .replace("{{SITE_TAGLINE}}", esc(site.tagline))
    .replace("{{ABOUT_ITEMS}}", aboutItems(config))
    .replace("{{SOURCE_NOTE}}", site.sourceNote)
    .replace("{{PROJECTS_BAR}}", projectsBar(config))
    .replace("{{CATEGORY_OPTIONS}}", categoryOptions)
    .replace("{{ROWS}}", rows || `<li class="empty">No live roles right now — check the archive or the RSS feed.</li>`)
    .replace("{{COVERAGE}}", coverage)
    .replace("{{ARCHIVE_COUNT}}", String(archived.length))
    .replace("{{UPDATED}}", `${formatDay(now)} ${now.slice(11, 16)} UTC`);

  const archive = archiveTemplate
    .replace("{{STYLE}}", style)
    .replaceAll("{{SITE_NAME}}", esc(site.name))
    .replace("{{SOURCE_LINK}}", site.sourceLink)
    .replace("{{GROUPS}}", archiveGroups(archived, config) || `<p class="empty">Nothing archived yet.</p>`)
    .replace("{{COVERAGE}}", coverage)
    .replace("{{ARCHIVE_COUNT}}", String(archived.length))
    .replace("{{UPDATED}}", `${formatDay(now)} ${now.slice(11, 16)} UTC`);

  return {
    "index.html": index,
    "archive.html": archive,
    "jobs.json": JSON.stringify(store, null, 2) + "\n",
    "feed.xml": rssFeed(active, siteUrl, config, site),
  };
}

async function main() {
  const data = (name, fallback) => {
    const url = new URL(name, DATA);
    return existsSync(url) ? JSON.parse(readFileSync(url, "utf8")) : fallback;
  };
  const store = data("jobs.json", emptyStore());
  const config = loadConfig(data("config.json", {}), { env: process.env });
  const remote = detectGitRemote();
  const repo = resolveRepo({ env: process.env, remote });
  const siteUrl = resolveSiteUrl({ config, env: process.env, remote });
  const files = renderSite({ store, config, siteUrl, repo });

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
