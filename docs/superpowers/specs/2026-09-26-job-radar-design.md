# Job Radar — design spec

- **Date:** 2026-09-26
- **Status:** approved (design brainstormed and approved in session `ses_f23a679eeffdEgCjx8rjUkNI9W`)
- **Repo:** `github.com/xpressabhi/job-radar` (new, public)
- **Site:** `https://xpressabhi.github.io/job-radar/`

## 1. Purpose

A daily-refreshed public page of **senior+ engineering roles in India** (or remote-India)
at employers **vetted to pay top-of-market**: companies vetted at ≥₹20L base generally and
≥₹50L base at senior levels, with displayed roles required to clear ₹50L base.

The page doubles as Abhishek's personal feed. His sweet spot: agentic AI / AI platform,
backend (Python/Java), frontend platform (React/TypeScript), staff level, Hyderabad or
remote-anywhere-in-India. The crawler hews to the strict pay bar the user chose, not to a
per-user profile; a small set of preset filters on the page covers the personal view.

**Success criteria**

- Page is fresh every day without manual work; runs for weeks unattended.
- No mid/junior titles and no below-bar pay leaks onto the active list.
- Closed roles leave the active list within ~2 successful crawl runs and land in the archive.
- Zero secrets required; public repo (unlimited Actions minutes, free Pages).

## 2. Non-goals

- Not a general job board: no internships, mid-level, or non-engineering roles (v1).
- No scraping of LinkedIn / Naukri / Instahyre / Cutshort / Wellfound: aggregators are out;
  the curated ATS universe is the only source.
- No applications, accounts, or alerts (RSS + JSON feeds exist; personal alerts can come later).
- Not a portfolio redesign: the portfolio repo only gains a nav link, later.

## 3. Decisions (brainstorm record)

| Decision | Choice |
|---|---|
| Audience | Public page, curated toward Abhishek's role set |
| Location | Standalone public repo (not inside `xpressabhi.github.io`) |
| Sources | Curated ATS universe only (~70 companies, public JSON APIs) |
| "High paying" | Company vetting ≥₹20L base; senior+ roles ≥₹50L base |
| Title gate | Senior/Staff/Principal/Lead/Architect/Head/Director/EM/VP only |
| Unlabeled titles | Included only at frontier-AI-tier companies, marked `tier-assumed` |
| Tagging | Rules-first taxonomy; GitHub Models LLM fallback for rule misses |
| Page | Single page with client-side filters + archive page + JSON/RSS feeds |
| Comp published as total only | Keep if converted total ≥₹50L, flag `base unverified` |
| Archiving | Two consecutive successful fetch misses; failures never archive |
| Stack | Node 20+, ESM `.mjs`, zero runtime dependencies |
| Ambiguous-title LLM | Provider-agnostic OpenAI-compatible fallback, optional (GitHub Models retired 2026-07-30); without a key the pipeline is rules-only |
| Personal shortlist | Local-only Jev (TypeSafe) ranking over `jobs.json`; keys and state never in the repo |

## 4. Architecture

```
GitHub Actions (daily cron 01:30 UTC = 07:00 IST, or manual dispatch)
  │
  ├─ crawl.mjs ──── sources/*.mjs ──→ ATS public JSON APIs
  │                   (Greenhouse, Lever, Ashby, SmartRecruiters, Workable; Workday later)
  │     │
  │     ├─ normalize → filters (India geo → seniority → pay) → classify → dedupe
  │     ├─ merge into data/jobs.json (firstSeen/lastSeen, two-strike archive)
  │     └─ append observations to data/comp-evidence.json
  │
  ├─ render.mjs ──→ site/ (index.html, archive.html, jobs.json, feed.xml)
  │
  └─ git commit (data only) → Pages artifact deploy
```

**Components**

| Piece | Responsibility |
|---|---|
| `data/companies.json` | Curated company universe + pay-vetting records (hand-maintained, PR-able) |
| `data/config.json` | Pay floors, FX table, crawl politeness settings, category taxonomy version |
| `scripts/sources/*.mjs` | One adapter per ATS: fetch board → normalized postings; fail soft |
| `scripts/lib/fetch.mjs` | HTTP with UA, timeout, 1 retry, polite delay (Lever `Crawl-delay: 1`) |
| `scripts/crawl.mjs` | Orchestrator: fetch all enabled companies, filter, classify, merge, archive |
| `scripts/classify.mjs` | Rules taxonomy + LLM fallback + cache |
| `scripts/render.mjs` | Static site + feeds from `data/jobs.json` |
| `scripts/verify-companies.mjs` | Human-run board health check (dead/moved/blocked) |
| `data/jobs.json` | The job store (active + archived), full history |
| `data/comp-evidence.json` | Appended base-pay observations from published postings |
| `data/health.json` | Per-company last ok/fail timestamps + consecutive failure counts |

**Repo layout**

```
job-radar/
├── data/            companies.json, config.json, jobs.json, comp-evidence.json, health.json
├── scripts/         crawl.mjs, classify.mjs, render.mjs, verify-companies.mjs
│   ├── sources/     greenhouse.mjs, lever.mjs, ashby.mjs, smartrecruiters.mjs, workable.mjs (+ workday later)
│   └── lib/         fetch.mjs, normalize.mjs, filters.mjs, store.mjs, taxonomy.mjs, llm.mjs, fx.mjs
├── templates/       index.html, archive.html, style.css, app.js
├── tests/           *.test.mjs + fixtures/ (trimmed real board payloads) + golden/
├── docs/superpowers/specs/   this spec
├── tasks/           plan.md, todo.md
└── .github/workflows/   crawl.yml, ci.yml
```

## 5. Data model

### `data/config.json`

```json
{
  "payFloorBaseLpa": 50,
  "companyPayFloorBaseLpa": 20,
  "fxToInr": { "USD": 87, "EUR": 95, "GBP": 112, "CAD": 64, "AUD": 57, "SGD": 65 },
  "fxNote": "Conservative (rounded down against the employee); reviewed quarterly.",
  "requestDelayMs": 1000,
  "timeoutMs": 20000,
  "retries": 1,
  "archiveMisses": 2,
  "userAgent": "job-radar/1.0 (+https://github.com/xpressabhi/job-radar)"
}
```

### `data/companies.json` (entry)

```json
{
  "name": "Stripe",
  "ats": "greenhouse",
  "slug": "stripe",
  "careersUrl": "https://stripe.com/careers/search",
  "tier": "saas",
  "india": { "offices": ["Bengaluru"], "remoteOk": true },
  "payVetting": {
    "generalBaseMinLpa": 30,
    "seniorBaseMinLpa": 55,
    "confidence": "verified",
    "sources": ["levels.fyi India 2026-08", "observed postings"],
    "verifiedOn": "2026-09-26",
    "notes": "Top-of-market India band; senior base clears 50L."
  },
  "enabled": true
}
```

`tier` ∈ `frontier-ai` | `big-tech` | `saas` | `india-product` | `remote-first` (used by the
unlabeled-title rule in §6.3). `payVetting.confidence` ∈ `verified` (backed by a checked
source or observed postings) | `estimate` (tier-based conservative floor awaiting reviewer
confirmation; upgraded as observed postings accrue in `comp-evidence.json`).

### `data/jobs.json` (record)

```json
{
  "id": "greenhouse:stripe:12345",
  "company": "Stripe",
  "title": "Senior Software Engineer, Backend",
  "category": "backend",
  "tags": ["python", "distributed-systems"],
  "seniority": "senior",
  "levelSource": "title",
  "location": {
    "raw": "Bengaluru, India",
    "cities": ["Bengaluru"],
    "mode": "hybrid",
    "indiaScope": "located"
  },
  "pay": { "published": true, "currency": "INR", "baseMinLpa": 55, "baseMaxLpa": 70, "totalOnly": false, "raw": "₹55L–70L base" },
  "url": "https://boards.greenhouse.io/stripe/jobs/12345",
  "postedAt": "2026-09-20",
  "firstSeen": "2026-09-26",
  "lastSeen": "2026-09-26",
  "misses": 0,
  "status": "active",
  "closedAt": null,
  "reopenedAt": null
}
```

`pay` alternative when nothing is published:
`{ "published": false, "vettedSeniorMinLpa": 55 }`.

`levelSource`: `title` | `llm` | `tier-assumed`.
`seniority`: `senior` | `staff` | `principal` | `lead` | `architect` | `head` | `director` |
`em` | `vp` | `unlabeled` (only with `levelSource: "tier-assumed"`).

### `data/comp-evidence.json` (appended observations)

```json
[{ "company": "Stripe", "title": "Senior Software Engineer, Backend",
   "currency": "INR", "baseMinLpa": 55, "baseMaxLpa": 70, "raw": "₹55L–70L base",
   "observedOn": "2026-09-26", "url": "https://..." }]
```

`data/health.json`: `{ "<company>": { "lastOk": "...", "lastFail": "...", "consecutiveFails": 0, "lastError": "..." } }`.

## 6. Crawl rules

### 6.1 Sources and fetching

- Adapters: Greenhouse, Lever, Ashby, SmartRecruiters, Workable (all public, documented or
  widely-used JSON; verified endpoints are catalogued in the session record). Workday is a
  later phase (POST-only, community-documented, bot-blocking risk).
- Politeness: sequential per company, `requestDelayMs` between requests, honest UA,
  20s timeout, 1 retry with backoff.
- Error isolation: one adapter failure never stops the run; it is recorded in `health.json`.
- Descriptions are captured when cheap (Ashby/Lever/Workable list payloads include them).
  For Greenhouse and SmartRecruiters, a per-job detail fetch is made only for postings that
  already passed the geo + seniority filters, capped per run.

### 6.2 Geography — keep if

- Location lists an Indian city or "India" (Bengaluru, Hyderabad, Pune, Mumbai, Delhi NCR /
  Gurugram / Noida, Chennai, Kolkata, Ahmedabad, Jaipur, Kochi, Indore, Coimbatore, ...), or
  the ATS reports country `IN`.
- Remote with India attached ("Remote – India"; restrictions list contains India).
- Remote with no country restriction exposed at all → kept, tagged `Remote (global)` and
  flagged "verify eligibility".
- Drop: any explicit restriction to other geographies ("Remote – US", EMEA-only, Canada-only)
  or non-India-only offices.

Each kept job gets `cities[]`, `mode` (`onsite` | `hybrid` | `remote`), and `indiaScope`:
`located` | `remote_india` | `remote_global`.

### 6.3 Title gate — engineering + seniority

- **Engineering gate:** non-engineering titles are dropped (sales, marketing, design,
  product/program management, finance, legal, HR, customer success, ...). A title must match
  engineering tokens (engineer/developer/SRE/platform/data/ML/security/...); engineering
  leadership (Engineering Manager, Director of Engineering, Head of Engineering) passes.
- **Include tokens:** Senior, Sr, Staff, Principal, Lead, Tech Lead, Architect, Head of,
  Director, Engineering Manager, VP.
- **Exclude tokens:** Intern, New Grad, Graduate, Junior, Associate, Entry, Apprentice,
  Engineer I, Engineer II.
- **No level marker** ("Software Engineer", "Member of Technical Staff", "Forward Deployed
  Engineer", ...) → included **only** when the company is frontier-AI tier; marked
  `levelSource: "tier-assumed"`. Everywhere else, excluded.
- Exclusion wins over inclusion when both appear.

### 6.4 Pay — the high-paying gate

- Company entry requires `generalBaseMinLpa >= 20` and `seniorBaseMinLpa >= 50` vetting
  (schema-validated; the validator rejects below-bar entries).
- For each role (all senior+ by the title gate), the floor is **₹50L base**:
  - **Published base** (Ashby compensation tiers, Lever `salaryRange`, Greenhouse pay
    transparency, Workable, SmartRecruiters): parse the base component, convert to INR with
    the conservative FX table, enforce ≥ ₹50L. The floor applies to the band's **lower
    bound** when a range is published ("minimum base ≥ ₹50L"); a single published value is
    its own lower bound. Below floor → dropped and counted in the run summary
    ("N roles dropped below pay floor"), never silently.
  - **Published as total only** (e.g. "$200k + equity", base not separable): keep when the
    converted total clears ₹50L, flagged `base unverified`; drop otherwise.
  - **Nothing published**: role stands on the company's senior vetting (`vettedSeniorMinLpa`).
- Equity and bonus never count toward the floor; only base (or total-only as above).
- Every published observation is appended to `comp-evidence.json`, so the company bands
  become self-verifying and re-auditable rather than frozen opinions.

### 6.5 Cleaning and dedupe

- Titles normalized: requisition IDs, "(Remote)", trailing city suffixes, emoji, doubled
  whitespace.
- URLs canonicalized: tracking params stripped; prefer the ATS-hosted posting URL over
  redirect/apply URLs.
- Dedupe key `ats:company:jobId`; near-duplicates (same company + normalized title + primary
  city) collapse to the newest.
- `postedAt` kept when the ATS exposes a real date (Ashby `publishedAt`, Lever `createdAt`,
  SmartRecruiters `releasedDate`, Greenhouse `first_published`); otherwise the page shows
  "first seen" from our crawl.

## 7. Classification

**Taxonomy (primary category + multi-tags):** `ai-ml` · `backend` · `frontend` ·
`fullstack` · `platform-infra` · `data` · `mobile` · `security` · `qa` · `embedded` ·
`engineering-leadership` · `other`.

- Rules read the title first, then the description when available, to assign the primary
  category and stack tags (React, Python, Kubernetes, LLM evals, ...).
- Rule misses (ambiguous titles such as "Member of Technical Staff") go to an optional
  LLM fallback: a provider-agnostic OpenAI-compatible chat-completions call configured by
  `LLM_API_BASE_URL` + `LLM_MODEL` (Actions vars) and `LLM_API_KEY` (repo secret), one
  batched call with a strict JSON schema; results are validated against the taxonomy and
  cached by title so each title is classified once ever.
- **GitHub Models was retired on 2026-07-30** (the endpoint now returns a plain-text
  tombstone), so there is no keyless fallback. Without a key the crawler stays rules-only:
  misses ship as `other` with a `needsClassify` marker and are retried on the next run.
  LLM usage is bounded (max ~40 new titles per run).
- Description text used for tagging is never sent to the LLM beyond title + department +
  company tier; if a description is needed, only the first ~400 characters of requirements.

## 8. Archiving

- A job seen in a successful board fetch has `misses` reset to 0 and `lastSeen` updated.
- A job absent from a **successful** fetch gets `misses += 1`; at `misses >= 2` (two
  consecutive successful misses) it flips to `status: "archived"` with `closedAt`.
- Failed fetches and zero-job responses **never** increment `misses` (outage protection).
- Archived records are kept forever; the archive page groups them by month. If a job with the
  same id reappears, it flips back to `active` with `reopenedAt` set.

## 9. Site

- `index.html`: header states the pay rule in plain words; last-updated timestamp; coverage
  strip ("62 boards scanned · 58 ok · +12 new today"). Filter bar (vanilla JS): category,
  city, remote mode, company, recency (24h/7d/30d), text search, plus preset buttons for the
  personal view (`ai-ml`, `backend`, `frontend` categories filtered to Hyderabad or
  remote-India). Rows
  are server-rendered (visible without JS) and progressively filtered client-side.
- Row display: title → original posting, company, location badge (`Bengaluru` ·
  `Remote (India)` · `Remote (global — verify)`), category + skill tags, seniority, pay as
  `₹55–70L base (published)` or `vetted: senior base ≥₹50L`, and posted/first-seen date.
- `archive.html`: closed roles grouped by month with open→closed span; same filters, simpler.
- Feeds: `jobs.json` (full data) and `feed.xml` (RSS, latest 50 active).
- Footer: methodology (pay rule, company vetting, two-strike archiving), coverage counts,
  dropped-below-floor count, degraded-run notice when applicable.
- Self-contained HTML/CSS/JS; no external assets; `prefers-color-scheme` dark/light;
  mobile-friendly; semantic HTML and keyboard-accessible filters.

## 10. Automation and operations

- `crawl.yml`: cron `30 1 * * *` UTC (07:00 IST) + `workflow_dispatch` with `--dry-run` and
  `--company` inputs for debugging. Steps: checkout → crawl → render → commit data changes
  (message e.g. `crawl: 2026-09-26 — +12 new, 5 archived, 58/62 boards ok`) → deploy Pages
  artifact. `concurrency` group prevents overlapping runs.
- Permissions: `contents: write`, `pages: write`, `id-token: write`. No repository secrets
  are required; `LLM_API_KEY` (plus optional `LLM_API_BASE_URL` / `LLM_MODEL` vars) enables
  the classification fallback only.
- Degraded run: if >50% of boards fail, the run still commits what succeeded and the page
  footer shows "degraded run"; archiving is suspended for that run.
- Health: each run updates `health.json`. A company failing 3 consecutive runs opens a
  GitHub issue automatically (deduped by label); recovery closes it.
- `verify-companies.mjs`: human-run deep check (board root, careers URL, alternate slugs),
  prints a table of ok/blocked/dead/moved.
- Only `data/*.json` is committed; `site/` is a Pages artifact, never in git.

## 11. Testing and verification

- `node --test` unit fixtures: title → category/seniority, location parsing per ATS shape,
  pay parsing (Ashby tiers, Lever `salaryRange`, Greenhouse pay transparency, total-only),
  FX conversion, two-strike archive logic, dedupe/cleaning.
- Replay harness: trimmed real board payloads run through the full pipeline offline,
  asserting exact store diffs against golden files — rule changes cannot silently mutate
  output.
- `ci.yml` on push/PR runs tests + replay (no network). The nightly job is the only place
  that crawls live.
- Manual checkpoints: after the first dry run (inspect real filtered output), after the
  first render (browser QA of filters, archive, dark mode, mobile width), after the first
  live scheduled run (page fresh, commit message sane).

## 12. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| ATS endpoints drift (Workable/Workday community endpoints) | Med | Per-adapter fixture tests; adapters fail soft; health issues; Workday deferred to phase 2 |
| GitHub Actions IPs bot-blocked by some Workday/Akamai tenants | Med | Tolerate; health-visible; alternative is local `workflow_dispatch` runs, not silent breakage |
| LLM provider unavailable or rate-limited | Low | Rules-only fallback; cache; bounded batches; `needsClassify` retry |
| Pay vetting wrong for a company | Med | Sources + dates recorded; observed postings append evidence; user review; conservative FX |
| Strict filters yield too few roles | Med | Start ~70 companies; tune tokens from first runs; add companies from health reports |
| Company list decay (M&A, board moves) | Low | Auto-issues after 3 failed runs; `verify-companies` table |
| `jobs.json` growth | Low | Single file until >5MB, then split archive by year |
| Daily commit noise | Low | Dedicated repo; data-only commits; skip when unchanged |

## 13. Build order

1. Scaffold repo (this spec, plan, config, scripts skeleton) + GitHub repo + Pages.
2. Draft `companies.json` with pay vetting → **stop for user review/prune**.
3. Adapters: Greenhouse, then Lever + Ashby, then SmartRecruiters + Workable.
4. Filters (geo/senior/pay) + store merge + two-strike archiving.
5. Classifier (rules + GitHub Models fallback + cache).
6. Renderer + feeds.
7. Workflows (crawl, CI) + health auto-issues.
8. First live run review → tune → hand over to cron. Later: Workday adapter, portfolio nav link.
9. Optional personal layer: local Jev ranking of `jobs.json` (see §14).

## 14. Personal layer (optional, local-only, after v1)

The public page is objective: it filters by pay, geography, and seniority. The personal
shortlist is profile-relative, so it runs locally, never in CI:

- `scripts/personal-rank.mjs` (local-only; requires `TYPESAFE_API_KEY` in the shell env,
  which is never added to the repo or Actions) reads `data/jobs.json` plus the local/CV
  profile and runs the job-finder-style Jev judges over candidates: eligibility (is this
  remote role really open to India?), level + stack match, red flags. Output: a ranked
  `output/personal-shortlist.md` with named gaps.
- Personal state stays under `~/.job-search/` (the job-finder tracker); nothing personal
  is committed to `job-radar`.
- Deterministic jobs (pay parsing, dedupe, archiving) never depend on Jev; it only ranks
  and annotates.
- If an API key is ever wanted inside Actions for better title classification, that is a
  separate decision requiring evidence that the GitHub Models fallback is insufficient.

## 15. Open questions

- None blocking. Portfolio nav link is a later, separate decision.
- `jobs.json` split-by-year threshold (5MB) is a guess; revisit when the store approaches it.
- Personal layer (§14): standalone `personal-rank.mjs` vs. teaching the job-finder skill to
  consume `jobs.json` as a source — decide when that task is picked up.
