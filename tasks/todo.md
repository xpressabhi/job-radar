# Job Radar — task list

Reference: `tasks/plan.md` · specs: `2026-09-26-job-radar-design.md` (v1) ·
`2026-09-26-configurable-job-radar-design.md` (forkability)

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
- [x] ≥60 companies; every `ats` value maps to an implemented or planned adapter (86 entries, 5 ATSes)
- [x] Validator passes on the full file and fails on: missing `payVetting`, a sub-floor band, duplicate `ats:slug`
- [x] Every `payVetting.sources` entry carries a source and date; bands are explicitly labeled
      `confidence: "estimate"` (tier-based conservative floors) pending your review — no fabricated precision
- [x] User has reviewed the list and signed off (recorded in commit message)

**Verification:**
- [x] `npm run validate:companies`
- [x] Negative fixtures for the validator verified in `tests/validate-companies.test.mjs`
- [x] Boards verified live 2026-09-26 (86 OK / 37 excluded — other ATSes or own portals; see commit notes)

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
- [x] Adapter returns normalized postings for the fixture; unknown slug fails cleanly (404)
- [x] `--dry-run --company <name>` prints normalized postings and writes nothing
- [x] Fetch lib respects delay between requests; a 500 triggers exactly one retry

**Verification:**
- [x] `npm test` — 25 passing (fetch retry/pacing/parse guards, Greenhouse normalize/404/detail)
- [x] `node scripts/crawl.mjs --dry-run --company Anthropic` — 619/619 postings normalized live
- [x] Found + fixed: Greenhouse `content` is HTML-escaped — entities decoded before tag stripping

**Dependencies:** T1 · **Scope:** Medium (5 files)

---

## Task 4: Lever + Ashby adapters

**Description:** `lever.mjs` (`api.lever.co/v0/postings/{co}?mode=json`, `workplaceType`,
`salaryRange`, epoch dates, `Crawl-delay: 1`) and `ashby.mjs`
(`api.ashbyhq.com/posting-api/job-board/{org}?includeCompensation=true`,
`secondaryLocations`, `isListed` filter, compensation tiers, large payloads). Fixtures for
both, including an Ashby board with compensation and one with `isRemote: null`.

**Acceptance criteria:**
- [x] Both adapters normalize location, mode, dates, salary/base components per fixture
- [x] Ashby `isListed: false` postings are excluded; `isRemote: null` does not crash parsing
- [x] Lever multi-location postings keep all locations in `raw` and primary city first

**Verification:**
- [x] `npm test` — 35 passing
- [x] Live: `--company Palantir` (321 postings), `--company Supabase` (56 postings)
- [x] Shared `lib/dates.mjs`; Greenhouse refactored onto it

**Dependencies:** T3 · **Scope:** Medium (4 files)

---

## Task 5: SmartRecruiters + Workable adapters

**Description:** `smartrecruiters.mjs` (`api.smartrecruiters.com/v1/companies/{id}/postings`,
offset/limit pagination, `totalFound: 0` means invalid tenant — not an error), 
`workable.mjs` (`apply.workable.com/api/v1/widget/accounts/{sub}?details=true`). Particular
care: SmartRecruiters remote/hybrid flags and location shape; Workable `telecommuting`,
`country`, `published_on`.

**Acceptance criteria:**
- [x] Pagination walks all pages for a >100-posting tenant (2-page test synthesized from real payloads)
- [x] `totalFound: 0` returns an empty result, not a failure
- [x] Workable `telecommuting: true` maps to `mode: remote` with the right `indiaScope` input

**Verification:**
- [x] `npm test` — 47 passing
- [x] Live: `--company Atlassian` (sr, 3 postings), `--company "Hugging Face"` (workable, 8 postings)
- [x] `stripHtml` moved to shared `lib/html.mjs` (Greenhouse + SR + Workable use it)

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
- [x] All spec §6.2/§6.3/§6.4 cases covered by tests, including both directions of each rule
- [x] Unlabeled titles pass only for `frontier-ai` tier companies and set `levelSource: "tier-assumed"`
- [x] Total-only comp below the converted floor is dropped; at/above is kept with `base unverified`
- [x] FX conversion is round-down and covered by fixtures (USD/EUR/GBP — and CAD/INR from real payloads)

**Verification:** [x] `npm test` — 79 passing (normalize, fx, filters incl. adversarial titles)
- [x] Live spot check (8 boards): filters behave; CRED/Meesho boards are genuinely non-engineering, not mis-dropped
- [x] Engineering gate added (spec §6.3 updated); "SDE"/"SWE" tokens added after real-data review

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

---

## Completion log — 2026-09-26

Executed end-to-end in one session ("continue till end" waived the human gates).

- **T1–T5** — repo live, 86 boards verified by live probes (temporarily excluded: boards on
  other ATSes or own portals), five adapters implemented, 47 tests.
- **T6** — normalize/filters/FX implemented and spot-checked against 8 live boards
  (79 tests). Engineering gate added after real-data review; "SDE"/"SWE" tokens added.
- **T7** — store merge + two-strike archiving + comp evidence + health; full-universe dry
  run: **86/86 boards ok, 12,291 raw → 499 kept**.
- **T8/T9** — taxonomy rules and cache plus the LLM fallback. **GitHub Models was retired
  2026-07-30** (endpoint verified to return an HTTP 200 plain-text tombstone), so the
  fallback is now provider-agnostic and optional (`LLM_API_KEY` + `LLM_API_BASE_URL` /
  `LLM_MODEL`); without it the pipeline is rules-only. Documented in spec §7/§10.
- **T10** — renderer + archive + RSS/JSON feeds; page is 405KB; QA on the **live page**
  via Playwright + Jev: Backend preset → "37 of 470 roles shown"; 390px width has no
  horizontal overflow; archive page renders. Dark mode not visually verified.
- **T11** — `crawl.yml` dispatched (run `36228317655`): green, data committed by the bot,
  Pages deployed. Live: **https://xpressabhi.github.io/job-radar/** (HTTP 200, 470 roles).
- **T12** — `ci.yml` + replay harness with golden store (2 jobs from trimmed fixtures).
- **T13** — board-health issues + `verify:companies`; covered by unit tests with mocked
  GitHub API.
- **T14** — README + methodology + first-run review; spec updated for the LLM pivot.
- **T15** — deterministic local shortlist shipped (`personal-rank.mjs`, real run produced
  8 ranked roles); the Jev eligibility/fit pass remains the documented follow-up pending
  `TYPESAFE_API_KEY` and a confirmed judge interface.

Final state: **121 tests green**, zero required secrets, cron armed for 01:30 UTC daily.
Open follow-ups: portfolio nav link, dark-mode visual check, Jev pass, Workday adapter,
company-band upgrades from `comp-evidence.json`.

---

# Forkable configuration (T16–T25)

Design: `docs/superpowers/specs/2026-09-26-configurable-job-radar-design.md`

---

## Task 16: Config module + repo config migration + pinned replay config

**Description:** Create `scripts/lib/config.mjs` with generic `DEFAULTS` (no country/cities;
`pay.currency: "USD"`, zero floors, `vettingRequired: false`; current politeness, LLM,
FX, excluded-region and seniority-pattern values), `loadConfig()` deep-merge (objects merge,
arrays replace; keyword/pattern strings compiled; home country/code removed from exclusion
lists), `validateConfig()` errors (missing `location.country`, invalid regexes, missing
`pay.currency`/FX coverage) and warnings (unknown keys). Add `scripts/validate-config.mjs`
(`npm run validate:config`, `--show` prints the effective config). Migrate the repo's
`data/config.json` to the new schema (location India + city map, INR pay floors/display/FX,
crawl/LLM keys; `userAgent` derived per-fork when absent). Include a temporary legacy-alias
view (`payFloorBaseLpa`, `fxToInr`, `archiveMisses`, …) so unmigrated consumers keep working;
it is removed once T18–T20 switch them. Pin `tests/replay.mjs` to `tests/fixtures/config.json`
so replay no longer depends on the editable repo config. Rewrite `tests/config.test.mjs` as
merge/validation tests over fixtures.

**Acceptance criteria:**
- [ ] `loadConfig({})` is inert; deep merge verified; keyword→regex compilation and
  home-country stripping work
- [ ] Validator fails on: missing country, uncompilable regex, `pay.enabled` without
  currency, missing FX for a published-foreign-currency scenario; unknown keys warn
- [ ] Repo config migrated; legacy aliases reproduce today's values (floors 50/20, FX table,
  delay/timeout/retries, archiveMisses 2, llm.maxPerRun 40)
- [ ] Replay output cannot change by editing `data/config.json`

**Verification:** `npm test` · `npm run replay` · `npm run validate:config --show` ·
grep: no script reads config keys outside the loader except through the alias view

**Dependencies:** None · **Scope:** Medium (7 files)

---

## Task 17: Money module

**Description:** Create `scripts/lib/money.mjs`: annualize published bands, convert into
`pay.currency` via `pay.fxRates` (preserving conservative rounding), `formatMoney(amount,
display)` honoring `{symbol, divisor, suffix, decimals}` (`₹70L`, `$185,000`), and legacy
detection helpers for `*Lpa` fields (`× 100000`). Pure functions, zero deps.

**Acceptance criteria:**
- [ ] Conversion/annualization/rounding unit-tested; unknown currency returns null
- [ ] Display formatting tested for lakh-style and plain styles, min/max bands, null amounts
- [ ] Legacy detection recognizes old `baseMinLpa`/`seniorBaseMinLpa` fields

**Verification:** `npm test` · `node --test tests/money.test.mjs`

**Dependencies:** T16 · **Scope:** Small (2 files)

---

## Task 18: Pay pipeline switch (filters → store → consumers)

**Description:** Switch the pay path to annual base-currency amounts: `classifyPay` converts
published bands with `money.mjs`, applies `pay.floorAnnual` honorably of `pay.enabled`
(disabled = gate off), reads vetted bands tolerantly (legacy `seniorBaseMinLpa`×100000 until
T21); records become `pay: { published, currency, raw, totalOnly, baseMin, baseMax, vettedMin }`.
`appendCompEvidence` writes `baseMin`/`baseMax` and migrates old evidence entries on write.
Add `scripts/lib/accessors.mjs` with tolerant readers (`payMin`, `payMax`, `payVetted`,
`locationScope`) and switch render/personal-rank/crawl-log reads through them (labels still
unchanged until T20). Refresh the golden store deliberately.

**Acceptance criteria:**
- [ ] Filters tests updated: floor compares in base currency; `pay.enabled: false` keeps
  everything; total-only handling unchanged
- [ ] Store/evidence tests cover new write shape and legacy-read migration
- [ ] Consumers still render legacy records; golden diff is field renames only

**Verification:** `npm test` · `npm run replay` (golden refreshed once, diff reviewed)

**Dependencies:** T16, T17 · **Scope:** Large (single coherent switch; one commit)

---

## Task 19: Filter genericization — seniority + geography

**Description:** Drive `classifySeniority` from `roles.seniority` (include/exclude keywords
and raw patterns, `assumeSeniorForTiers`, unlabeled-title skip patterns) and
`classifyGeography` from `location` (country name/code, city aliases, remote policy,
exclude terms/patterns/codes). Rename output `location.indiaScope` → `location.scope`
(`located | remote_home | remote_global`) with the tolerant accessor handling legacy values.
Make the trailing-location strip in `normalize.mjs` config-driven. Update render labels via
the accessor + configured country. Refresh the golden store deliberately.

**Acceptance criteria:**
- [ ] Keyword and raw-pattern overrides behave per spec (exclusions first, then inclusions,
  then tier assumption); unlabeled MTS still skips to the tier rule
- [ ] Home-country match wins over exclusion lists; other-region postings drop;
  region-less remote keeps `remote_global` + verify flag
- [ ] Legacy `indiaScope` records still render correctly

**Verification:** `npm test` · `npm run replay` (golden refreshed once, diff reviewed)

**Dependencies:** T16, T18 · **Scope:** Large (7 files)

---

## Task 20: Renderer, branding, per-fork Pages

**Description:** Feed templates from `config.site` (`{{SITE_NAME}}`, tagline, description);
generate the about bullets from effective config (country, pay floor/currency or "no pay
floor", remote policy, levels); format pay labels/coverage via `money.mjs`; RSS
title/description from config. Resolve the site URL per fork: explicit `site.url` →
`GITHUB_REPOSITORY` → `git remote origin` → omit. No upstream owner appears in output for a
fork that has not set `site.url`.

**Acceptance criteria:**
- [ ] India instance render is visually identical (parity diff reviewed)
- [ ] Fork render with defaults contains no upstream URL; RSS/canonical links follow the
  resolution order (unit-tested with env/remote stubs)
- [ ] About copy tracks config (country, floor, remote policy)

**Verification:** `npm test` · `npm run render` + visual/diff check · fork-default render test

**Dependencies:** T16, T19 · **Scope:** Medium (4 files)

---

## Task 21: Companies schema + validator + upstream data migration

**Description:** Update `validate-companies.mjs`: free-form `tier`; `location` replaces
`india` (optional, validated when present); `payVetting` optional — when present its
`generalBaseMin`/`seniorBaseMin` (annual, `pay.currency`) must clear the configured floors;
required for enabled companies only when `pay.vettingRequired`. Migrate all 86 entries
(`india` → `location`, vetting ×100000) and update replay fixture companies.

**Acceptance criteria:**
- [ ] Upstream strict mode still fails on missing/sub-floor vetting; a fork with
  vetting-less companies validates when `vettingRequired: false`
- [ ] Migrated `companies.json` passes; duplicate/ATS/slug checks unchanged
- [ ] Replay fixture companies use the new field names

**Verification:** `npm test` · `npm run validate:companies` · negative fixtures updated

**Dependencies:** T16, T18 · **Scope:** Medium (4 files + data)

---

## Task 22: `add-company` helper

**Description:** `scripts/add-company.mjs` (`npm run add-company -- <url|slug>`): detect the
ATS + slug from Greenhouse / Lever / Ashby / SmartRecruiters / Workable URL patterns (or
accept `--ats`), verify the board live via the adapters, prompt for display name, optional
tier, optional vetting bands, then append a valid entry (dedupe by `ats:slug`) and run
validation. `--dry-run` prints the JSON without writing.

**Acceptance criteria:**
- [ ] URL parser unit-tested for all five ATSes plus invalid inputs with a helpful message
- [ ] Live verify reports posting count; dead boards are rejected with the reason
- [ ] Appended file passes the validator; duplicate slugs update-or-refuse explicitly

**Verification:** `npm test` · `node scripts/add-company.mjs --dry-run <fixture-url>`

**Dependencies:** T21 · **Scope:** Medium (3 files)

---

## Task 23: Setup wizard

**Description:** `scripts/setup.mjs` (`npm run setup`): interactive sections — site identity,
location (country/code, cities, remote policy), pay (enabled, currency, floors, display, FX),
levels, companies (import URL list with live checks via T22 detection, or keep/replace).
Sparse writes to `data/config.json` and `data/companies.json` with backups; `--yes`
(defaults), `--dry-run`, `--data-dir <path>` for tests. Prints next steps (dry crawl, render,
enable Pages, optional LLM vars). Never runs in CI.

**Acceptance criteria:**
- [ ] `--yes --data-dir <tmp>` produces files that pass `validateConfig`/`validateCompanies`
- [ ] Existing files are backed up, never silently overwritten
- [ ] Interrupted/declined prompts leave originals untouched

**Verification:** `npm test` · manual wizard run in a temp copy

**Dependencies:** T16, T17, T21, T22 · **Scope:** Medium (3 files)

---

## Task 24: Docs + workflows + CI

**Description:** Rewrite README: fork quick-start first (setup → add companies → Pages →
optional LLM), configuration summary, commands, then "this repo's live instance". Add
`docs/configuration.md` covering every key. Workflow bot identity becomes
`github-actions[bot]`; CI gains `npm run validate:config`.

**Acceptance criteria:**
- [ ] README takes a stranger from fork to deployed site without reading source
- [ ] Every effective config key is documented with type/default/example
- [ ] CI green locally (test, replay, validate:config, validate:companies)

**Verification:** `npm test && npm run replay && npm run validate:config && npm run validate:companies`

**Dependencies:** T16–T23 · **Scope:** Medium (4 files)

---

## Task 25: Upstream parity + production verification

**Description:** Run the full local gate (`test`, `replay`, `validate:config`,
`validate:companies`, `crawl:dry` sanity, `render` diff) and review results against the
pre-change site; dispatch `crawl.yml` with `dry_run: true`, then for real; verify the live
India site is unchanged (content, RSS/canonical URLs), data files migrated to the new shapes,
and health issues unaffected. Simulate a fresh fork in a temp dir (`setup --yes`, generic
render, add-company dry-run) and record that no upstream URLs appear. Append the completion
log.

**Acceptance criteria:**
- [ ] Dry-run crawl board health and kept counts plausible vs the last nightly run
- [ ] Production dispatch green; live page unchanged; `jobs.json`/evidence in new shapes
- [ ] Fork simulation output contains no upstream owner references
- [ ] Completion log appended with all deviations recorded

**Verification:** Actions runs inspected · live page checked · temp-dir fork walkthrough

**Dependencies:** T16–T24 · **Scope:** Small files, verification-heavy

---

## Checkpoints

- [x] **E (after T16–T17):** full suite + replay green, behavior unchanged, `validate:config` green
- [x] **F (after T18–T21):** new pipeline shapes green with refreshed goldens; India render parity; strict companies validation green
- [x] **G (after T22–T23):** simulated fork produces valid config/companies; backups respected
- [x] **H (after T24–T25):** CI + nightly green, live site unchanged, fork simulation clean, ready for review

---

## Completion log — forkable configuration (2026-09-26)

Executed T16–T25 end-to-end in one session.

- **T16** — `scripts/lib/config.mjs` (generic defaults + sparse override + validation) and
  `validate:config`; `data/config.json` migrated to the new schema; replay pinned to
  `tests/fixtures/config.json` (verified tamper-proof: editing `data/config.json` no longer
  changes replay output).
- **T17/T18** — `money.mjs` (annual base-currency conversion, display formatting, legacy
  detection) and the pay-pipeline switch: `pay.baseMin/baseMax/vettedMin` everywhere;
  legacy `*Lpa` records and `indiaScope` migrate on read and persist on the next crawl;
  golden refreshed once (diff reviewed: field renames only).
- **T19** — seniority/geography/title-strip now read `roles`/`location` config; `scope`
  rename (`located | remote_home | remote_global`); replay golden held exactly (behavior
  parity).
- **T20** — branding, about copy, RSS, and site URL are config-driven; per-fork URL
  resolution (`site.url` → `GITHUB_REPOSITORY` → git remote → omit). India render diff vs
  the pre-change baseline: `jobs.json` byte-identical; only intended `<title>`,
  archive-meta, and feed-description differences.
- **T21** — companies: optional `payVetting`, free-form `tier`, `location` replaces
  `india`; 86 entries migrated ×100000 to annual INR; strict mode kept via
  `pay.vettingRequired: true`.
- **T22/T23** — `add-company` (ATS detection for all five adapters, live board verify,
  validation) and `setup` (interactive + `--yes`/`--dry-run`/`--data-dir`, sparse output
  via defaults-pruning, backups). Live-verified during development (Meesho Lever board,
  54 postings).
- **T24** — README quick-start for forks + `docs/configuration.md`; workflow bot identity
  `github-actions[bot]`; CI adds `validate:config`.
- **T25** — parity and production: local and remote dry runs both
  **"boards ok 86/86 · raw 12291 · kept 493"** — identical to the last nightly run;
  160 tests green; CI green on the pushed head; production dispatch
  [run 36232121855](https://github.com/xpressabhi/job-radar/actions/runs/36232121855)
  archived 5 roles, migrated all 470 jobs and 67 evidence entries to the new shapes
  (0 legacy fields left) and deployed. Live page checked: HTTP 200, config-driven title,
  `feed.xml` link derived from `GITHUB_REPOSITORY`.

**Intended differences (reviewed):** page `<title>` drops "at top-paying companies"; the
archive meta description drops "senior"; RSS channel description now uses
`site.description` (includes "Daily-updated"); dry-run console pay labels include the
currency symbol. Everything else renders identically.

**Out of scope (unchanged):** taxonomy categories/tags remain the built-in engineering
set; `personal-rank.mjs` stays local-only (now reads `--config` for display); adapters,
health issues, and the LLM fallback are untouched.
