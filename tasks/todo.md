# Job Radar — task list

Reference: `tasks/plan.md` · design spec: `docs/superpowers/specs/2026-09-26-job-radar-design.md`

---

## Task 1: Repo scaffold + GitHub repo + Pages

**Description:** Create the repo structure (`data/`, `scripts/`, `scripts/sources/`,
`scripts/lib/`, `templates/`, `tests/`), `package.json` (ESM, Node >=20, scripts: `crawl`,
`crawl:dry`, `render`, `test`, `replay`, `validate:companies`, `verify:companies`),
`.gitignore` (`node_modules/`, `site/`, `output/`), a README stub, and `data/config.json`
with the floors, FX table, and politeness settings from the spec. Initialize git on `main`,
create `github.com/xpressabhi/job-radar` (public), push, and enable Pages with
`build_type: workflow` via `gh api`.

**Acceptance criteria:**
- [x] Public repo exists with `main` pushed; commit style is conventional commits
- [x] `gh api repos/xpressabhi/job-radar/pages` shows `build_type: "workflow"`
- [x] `data/config.json` matches spec §5 (floors 50/20, FX table, delays, `archiveMisses: 2`)
- [x] `npm run` lists all scripts; `npm test` exits 0 (config smoke tests)

**Verification:**
- [x] `gh repo view xpressabhi/job-radar --json visibility,defaultBranchRef`
- [x] `npm run` output inspected; `npm test` = 4 passing tests
- [x] Node 24 rejected `node --test tests/` — script uses default discovery (`node --test`), works on Node 20+

**Dependencies:** None · **Scope:** Small (5 files)

---

## Task 2: `companies.json` draft with pay vetting + validator

**Description:** Draft 60–80 India-hiring companies across tiers (`frontier-ai`, `big-tech`,
`saas`, `india-product`, `remote-first`) with ATS adapter, slug, careers URL, India presence,
and a `payVetting` record (general base ≥₹20L, senior base ≥₹50L, sources with dates, notes).
Seed from the job-finder reference universe plus public comp data; research current bands
where uncertain. Write `scripts/validate-companies.mjs` enforcing schema, floors, tier enum,
duplicate slug detection, and adapter-name validity. **Stop for user review/prune.**

**Acceptance criteria:**
- [ ] ≥60 companies; every `ats` value maps to an implemented or planned adapter
- [ ] Validator passes on the full file and fails on: missing `payVetting`, a sub-floor band, duplicate `ats:slug`
- [ ] Every `payVetting.sources` entry carries a source and date; no invented numbers
- [ ] User has reviewed the list and signed off (recorded in commit message)

**Verification:**
- [ ] `npm run validate:companies`
- [ ] Negative fixtures for the validator verified in `tests/validate-companies.test.mjs`

**Dependencies:** T1 · **Scope:** Medium (3 files + data)

---

## Task 3: Fetch lib + adapter framework + Greenhouse + crawl CLI skeleton

**Description:** `scripts/lib/fetch.mjs` (UA, 20s timeout, 1 retry with backoff, polite
delay, JSON parse guard), `scripts/sources/index.mjs` adapter registry, and
`scripts/sources/greenhouse.mjs` (list via `boards-api.greenhouse.io/v1/boards/{slug}/jobs`,
per-job `?content=true` detail fetch only for postings passing geo + seniority filters, cap
per run). `scripts/crawl.mjs` CLI skeleton with `--dry-run` (print normalized postings, no
writes) and `--company <name>`. Trimmed real payload fixtures for tests.

**Acceptance criteria:**
- [ ] Adapter returns normalized postings for the fixture; unknown slug fails cleanly (404)
- [ ] `--dry-run --company <name>` prints normalized postings and writes nothing
- [ ] Fetch lib respects delay between requests; a 500 triggers exactly one retry

**Verification:**
- [ ] `npm test`
- [ ] `node scripts/crawl.mjs --dry-run --company Anthropic` (manual, live network)

**Dependencies:** T1 · **Scope:** Medium (5 files)

---

## Task 4: Lever + Ashby adapters

**Description:** `lever.mjs` (`api.lever.co/v0/postings/{co}?mode=json`, `workplaceType`,
`salaryRange`, epoch dates, `Crawl-delay: 1`) and `ashby.mjs`
(`api.ashbyhq.com/posting-api/job-board/{org}?includeCompensation=true`,
`secondaryLocations`, `isListed` filter, compensation tiers, large payloads). Fixtures for
both, including an Ashby board with compensation and one with `isRemote: null`.

**Acceptance criteria:**
- [ ] Both adapters normalize location, mode, dates, salary/base components per fixture
- [ ] Ashby `isListed: false` postings are excluded; `isRemote: null` does not crash parsing
- [ ] Lever multi-location postings keep all locations in `raw` and primary city first

**Verification:**
- [ ] `npm test`
- [ ] `node scripts/crawl.mjs --dry-run --company Palantir` and `--company OpenAI`

**Dependencies:** T3 · **Scope:** Medium (4 files)

---

## Task 5: SmartRecruiters + Workable adapters

**Description:** `smartrecruiters.mjs` (`api.smartrecruiters.com/v1/companies/{id}/postings`,
offset/limit pagination, `totalFound: 0` means invalid tenant — not an error), 
`workable.mjs` (`apply.workable.com/api/v1/widget/accounts/{sub}?details=true`). Particular
care: SmartRecruiters remote/hybrid flags and location shape; Workable `telecommuting`,
`country`, `published_on`.

**Acceptance criteria:**
- [ ] Pagination walks all pages for a >100-posting tenant (fixture with 2 pages)
- [ ] `totalFound: 0` returns an empty result, not a failure
- [ ] Workable `telecommuting: true` maps to `mode: remote` with the right `indiaScope` input

**Verification:**
- [ ] `npm test`
- [ ] `node scripts/crawl.mjs --dry-run --company Atlassian` and `--company "Hugging Face"`

**Dependencies:** T3 · **Scope:** Medium (4 files)

---

## Task 6: Normalizer + geo/senior/pay filters + FX

**Description:** `lib/normalize.mjs` (title cleanup, URL canonicalization, postedAt
normalization, dedupe key), `lib/fx.mjs` (conservative conversion to LPA, round-down),
`lib/filters.mjs`: India geography rules (§6.2), seniority token gate with
exclusion-beats-inclusion and the frontier-AI unlabeled-title rule (§6.3), pay gate with
published-base enforcement, total-only handling, and below-floor drop counting (§6.4).
Config-driven; every rule unit-tested with adversarial titles ("Senior Director" when only
"Director" listed, "Data Engineer II", "Remote - India", "Remote - US").

**Acceptance criteria:**
- [ ] All spec §6.2/§6.3/§6.4 cases covered by tests, including both directions of each rule
- [ ] Unlabeled titles pass only for `frontier-ai` tier companies and set `levelSource: "tier-assumed"`
- [ ] Total-only comp below the converted floor is dropped; at/above is kept with `base unverified`
- [ ] FX conversion is round-down and covered by fixtures (USD/EUR/GBP)

**Verification:** [ ] `npm test`

**Dependencies:** T3 · **Scope:** Medium (4 files)

---

## Task 7: Store merge + two-strike archiving + comp evidence + health

**Description:** `lib/store.mjs`: load/save `data/jobs.json`; merge crawl results
(`firstSeen` set on insert, `lastSeen`/`misses` reset on seen, counts for the run summary);
two-strike archive (`misses >= 2` → `status: archived`, `closedAt`) with failed and zero-job
fetches excluded from miss counting; reopen detection (`reopenedAt`); append to
`data/comp-evidence.json`; write `data/health.json` per company. Wire into `crawl.mjs` with
`--dry-run` still writing nothing.

**Acceptance criteria:**
- [ ] New/seen/missed/archived/reopened transitions all covered by fixture-driven tests
- [ ] A run where 60% of boards fail marks the run degraded and skips archiving entirely
- [ ] `--dry-run` leaves every file byte-identical (test asserts mtime/content hash)
- [ ] Run summary string matches the commit-message format (`+N new, M archived, X/Y boards ok`)

**Verification:**
- [ ] `npm test`
- [ ] Two consecutive `--dry-run` runs against 5 real companies produce stable output

**Dependencies:** T6 · **Scope:** Medium (2 files + tests)

#### Checkpoint B (after T3–T7)
- [ ] Dry run spans the full company universe with per-company isolation (no run aborts)
- [ ] Filtered output reviewed on real data; suspicious drops explained (not silently lost)
- [ ] **Review with human before classification work**

---

## Task 8: Taxonomy rules + tests

**Description:** `lib/taxonomy.mjs`: primary category assignment from title/description
keywords for `ai-ml`, `backend`, `frontend`, `fullstack`, `platform-infra`, `data`, `mobile`,
`security`, `qa`, `embedded`, `engineering-leadership`, `other`; stack tag extraction
(react, typescript, python, java, go, kubernetes, llm-evals, rag, ...). Deterministic
precedence rules; `other` + `needsClassify` for misses. Avoid false positives ("React" in
"Reactive Systems" style traps) — word-boundary matching, tested.

**Acceptance criteria:**
- [ ] ≥40 title fixtures map to expected primary categories; ambiguous ones land in `needsClassify`
- [ ] Multi-tag extraction capped, deduped, lowercased, and stable across runs
- [ ] No rule reads `undefined` fields when descriptions are absent

**Verification:** [ ] `npm test`

**Dependencies:** T6 · **Scope:** Medium (2 files)

---

## Task 9: GitHub Models fallback + cache

**Description:** `lib/llm.mjs`: batch `needsClassify` titles (max ~40/run) to
`https://models.github.ai/inference/chat/completions` with `GITHUB_TOKEN`, strict JSON
schema (category + tags), validation against the taxonomy enum, and a `data/llm-cache.json`
keyed by normalized title + department. Timeout, retry-once, and a clean fallback path that
leaves jobs as `other`/`needsClassify` for the next run. No-op without a token so local runs
still work.

**Acceptance criteria:**
- [ ] Cached titles are never re-queried; cache survives runs and is committed
- [ ] Invalid/partial model JSON is rejected per-item without failing the run
- [ ] Token missing or 429 → zero exceptions, jobs remain queued for retry
- [ ] Tests use a mocked fetch; no live calls in CI

**Verification:** [ ] `npm test`

**Dependencies:** T8 · **Scope:** Medium (3 files)

---

## Task 10: Renderer, templates, feeds, no-JS fallback

**Description:** `scripts/render.mjs` + `templates/` (index, archive, style.css, app.js):
server-rendered job rows (visible without JS), progressive-enhancement filters (category,
city, mode, company, recency, search), personal-view presets (`ai-ml`/`backend`/`frontend`
× Hyderabad/remote-India), coverage strip, pay-rule explainer, dropped-below-floor count,
degraded-run notice, `archive.html` grouped by month, `jobs.json`, `feed.xml` (latest 50).
Self-contained assets, dark/light, mobile-friendly, keyboard-accessible controls.

**Acceptance criteria:**
- [ ] Rendered `site/index.html` shows all active jobs with rows matching spec §9 fields
- [ ] Filters + presets work from `file://` with JS disabled/enabled (no-JS = full list)
- [ ] Archive page groups closed roles by month with open→closed spans
- [ ] `feed.xml` parses as valid RSS; `jobs.json` contains active + archived records
- [ ] No external network requests in the rendered page (fonts/images inlined or absent)

**Verification:**
- [ ] `npm run render -- --from fixtures` produces `site/` from test data
- [ ] Manual browser QA: filters, archive, dark mode, 390px width

**Dependencies:** T7, T8 · **Scope:** Large (4+ template files, render script)

#### Checkpoint C (after T8–T10)
- [ ] Full pipeline dry-run → render → human QA of the page
- [ ] **Review with human before wiring automation**

---

## Task 11: `crawl.yml` — cron, manual inputs, commit, Pages deploy

**Description:** Workflow with `schedule: 30 1 * * *`, `workflow_dispatch` inputs
(`dry_run`, `company`), `concurrency` group, permissions (`contents: write`,
`pages: write`, `id-token: write`, `models: read`), setup-node 20, run crawl → render →
commit `data/*.json` when changed (message per spec) → `actions/upload-pages-artifact` +
`actions/deploy-pages`. Dry-run mode never commits or deploys.

**Acceptance criteria:**
- [ ] Manual dry run and a real manual run both succeed; dry run commits nothing
- [ ] A no-change run skips the commit and still deploys the existing site
- [ ] Two overlapping runs serialize via the concurrency group
- [ ] No secrets referenced anywhere in the workflow

**Verification:** [ ] `gh workflow run crawl.yml -f dry_run=true` then a real run; inspect run log + commit

**Dependencies:** T10 · **Scope:** Medium (1 file)

---

## Task 12: `ci.yml` + replay harness

**Description:** `tests/replay.mjs`: load trimmed fixtures for every adapter, run the full
offline pipeline (normalize → filters → classify with mocked LLM → merge into a scratch
store), and diff the resulting store against `tests/golden/store.json` (stable key order,
explicit float formatting). `ci.yml` on push/PR: Node 20, `npm test`, `npm run replay`,
`npm run validate:companies`. No network.

**Acceptance criteria:**
- [ ] Replay diff is byte-stable across runs on the same input
- [ ] A deliberate rule change that alters output fails replay until golden is regenerated
      (`npm run replay -- --update-golden`)
- [ ] CI passes on a fresh clone with no cache and no secrets

**Verification:** [ ] Push a scratch branch; watch CI green; then run `--update-golden` and see it go red until committed

**Dependencies:** T10 · **Scope:** Medium (3 files)

---

## Task 13: Health auto-issues + `verify-companies.mjs`

**Description:** In `crawl.mjs`, after writing `health.json`: a company with 3 consecutive
failed runs opens (or comments never duplicates) a GitHub issue labeled `board-health` via
`gh api`, and a recovery closes it. `scripts/verify-companies.mjs`: human-run deep check of
each company (board endpoint, careers URL, alternate slugs) printing an ok/blocked/dead/moved
table with suggestions.

**Acceptance criteria:**
- [ ] Simulated 3-failure sequence opens exactly one issue (deduped by label + company name)
- [ ] Recovery closes the issue; failure count resets
- [ ] `verify-companies` output distinguishes bot-block (403/406/5xx) from missing (404)

**Verification:** [ ] `npm test` with mocked `gh`/fetch; `npm run verify:companies` (manual)

**Dependencies:** T11 · **Scope:** Medium (2 files)

---

## Task 14: README/methodology + first live run + handover

**Description:** README (what it is, the pay rule, how to add a company, how to run the
crawler locally, troubleshooting) and a methodology section the site footer links to. Run
the first real scheduled cycle, review the store diff and the rendered page together with
the user, tune token lists/pay parsing if real data disagrees, then flip cron on.

**Acceptance criteria:**
- [ ] Two consecutive scheduled runs are green with sane summaries
- [ ] Page shows a non-trivial active list; every job passes the pay rule on manual spot-check
- [ ] A known-closed role has moved to the archive after two runs
- [ ] README lets a newcomer run `npm run crawl:dry` and understand the output

**Verification:** [ ] Inspect two scheduled runs + live page; human sign-off

**Dependencies:** T11, T12, T13 · **Scope:** Medium (docs + review)

#### Checkpoint D: Complete
- [ ] All acceptance criteria met; cron running unattended
- [ ] Portfolio nav-link decision recorded (separate follow-up)

---

## Task 15 (optional, after v1): Local Jev ranking over `jobs.json`

**Description:** `scripts/personal-rank.mjs`, run only on the user's machine: reads
`data/jobs.json` + the local profile/CV, calls the job-finder-style Jev judges
(`TYPESAFE_API_KEY` from shell env; never a repo secret) for eligibility, level/stack match,
and red flags, and writes a ranked `output/personal-shortlist.md` with named gaps. Leaves
the job-finder tracker (`~/.job-search/`) as the personal memory layer. Never runs in CI.

**Acceptance criteria:**
- [ ] Script refuses to run without `TYPESAFE_API_KEY` and never logs the key
- [ ] Shortlist ranks only jobs passing the public pay/geo gates, annotating eligibility
- [ ] Missing key/API failure degrades to an unranked listing, not a crash
- [ ] No personal data or keys are written into the repo or CI

**Verification:** [ ] Local run over a fixture `jobs.json`; inspect `personal-shortlist.md`

**Dependencies:** T14 · **Scope:** Medium (1 script + tests)
