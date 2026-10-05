#!/usr/bin/env node
// Board health → GitHub issues. Runs after a crawl: a company failing >= threshold
// consecutive runs gets one open issue (deduped by label + company slug); recovery closes it.
// No-op without GH_TOKEN / GITHUB_REPOSITORY so local runs and tests are safe.
import { readFileSync, existsSync } from "node:fs";

const API = "https://api.github.com";
const LABEL = "board-health";
const LABEL_COLOR = "5319e7";
const LABEL_DESCRIPTION = "Automated: company ATS board failing consecutive crawls";
const TITLE_PREFIX = "[board-health]";

const bodySnippet = async (res) => {
  try {
    const text = typeof res.text === "function" ? await res.text() : "";
    return text ? ` — ${text.slice(0, 200)}` : "";
  } catch {
    return "";
  }
};

async function ensureLabel({ repo, headers, fetchImpl }) {
  const getRes = await fetchImpl(`${API}/repos/${repo}/labels/${encodeURIComponent(LABEL)}`, { headers });
  if (getRes.ok) return;
  if (getRes.status !== 404) {
    throw new Error(`checking label "${LABEL}" failed: HTTP ${getRes.status}${await bodySnippet(getRes)}`);
  }
  const createRes = await fetchImpl(`${API}/repos/${repo}/labels`, {
    method: "POST",
    headers,
    body: JSON.stringify({ name: LABEL, color: LABEL_COLOR, description: LABEL_DESCRIPTION }),
  });
  if (!createRes.ok) {
    throw new Error(`creating label "${LABEL}" failed: HTTP ${createRes.status}${await bodySnippet(createRes)}`);
  }
}

export async function syncHealthIssues({ health, repo, token, fetchImpl = globalThis.fetch, threshold = 3 }) {
  const result = { opened: [], closed: [], skipped: false };
  if (!repo || !token) {
    result.skipped = true;
    return result;
  }
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "job-radar-health",
  };

  const listRes = await fetchImpl(`${API}/repos/${repo}/issues?state=open&labels=${LABEL}&per_page=100`, { headers });
  if (!listRes.ok) throw new Error(`listing issues failed: HTTP ${listRes.status}`);
  const openIssues = await listRes.json();
  const issueBySlug = new Map();
  for (const issue of openIssues) {
    const match = String(issue.title ?? "").match(new RegExp(`^\\${TITLE_PREFIX}\\s+(.+)$`));
    if (match) issueBySlug.set(match[1].trim(), issue.number);
  }

  let labelEnsured = false;
  for (const [slug, entry] of Object.entries(health ?? {})) {
    const fails = entry?.consecutiveFails ?? 0;
    const existing = issueBySlug.get(slug);
    if (fails >= threshold && !existing) {
      if (!labelEnsured) {
        await ensureLabel({ repo, headers, fetchImpl });
        labelEnsured = true;
      }
      const res = await fetchImpl(`${API}/repos/${repo}/issues`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          title: `${TITLE_PREFIX} ${slug}`,
          labels: [LABEL],
          body: [
            `**Board:** \`${slug}\`  `,
            `**Consecutive failed crawls:** ${fails}  `,
            `**Last error:** ${entry.lastError ?? "unknown"}  `,
            `**Last success:** ${entry.lastOk ?? "never"}`,
            "",
            "The crawler keeps the company's existing roles untouched while its board fails.",
            "When the board recovers, this issue closes automatically. Check with `npm run verify:companies`.",
          ].join("\n"),
        }),
      });
      if (!res.ok) {
        throw new Error(`opening issue for ${slug} failed: HTTP ${res.status}${await bodySnippet(res)}`);
      }
      const issue = await res.json();
      result.opened.push(slug);
      if (issue?.number) issueBySlug.set(slug, issue.number);
    } else if (fails === 0 && existing) {
      const commentRes = await fetchImpl(`${API}/repos/${repo}/issues/${existing}/comments`, {
        method: "POST",
        headers,
        body: JSON.stringify({ body: "Board recovered — closing automatically." }),
      });
      if (!commentRes.ok) {
        throw new Error(`commenting on issue #${existing} failed: HTTP ${commentRes.status}${await bodySnippet(commentRes)}`);
      }
      const res = await fetchImpl(`${API}/repos/${repo}/issues/${existing}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ state: "closed" }),
      });
      if (!res.ok) {
        throw new Error(`closing issue #${existing} failed: HTTP ${res.status}${await bodySnippet(res)}`);
      }
      result.closed.push(slug);
    }
  }
  return result;
}

async function main() {
  const healthPath = new URL("../data/health.json", import.meta.url);
  const health = existsSync(healthPath) ? JSON.parse(readFileSync(healthPath, "utf8")) : {};
  const res = await syncHealthIssues({
    health,
    repo: process.env.GITHUB_REPOSITORY,
    token: process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN,
  });
  if (res.skipped) {
    console.log("health-issues: no repo/token in env — skipped");
    return 0;
  }
  console.log(`health-issues: opened ${res.opened.length}${res.opened.length ? ` (${res.opened.join(", ")})` : ""}, closed ${res.closed.length}${res.closed.length ? ` (${res.closed.join(", ")})` : ""}`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await main();
}
