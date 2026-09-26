# Implementation Plan: Job Radar

## Overview

Build `job-radar`: a public GitHub repo whose Actions workflow crawls ~70 curated company
ATS boards daily, keeps senior+ India-relevant engineering roles at employers vetted to pay
top-of-market (≥₹20L base general, ≥₹50L base at senior levels), tags them, and publishes a
static page with filters, an archive of closed roles, and JSON/RSS feeds. Full design in
`docs/superpowers/specs/2026-09-26-job-radar-design.md`.

## Architecture Decisions

- **Node 20+, ESM `.mjs`, zero runtime dependencies** — matches the portfolio repo's
  conventions; nothing to keep patched; Actions-friendly.
- **Curated ATS universe only** — Greenhouse, Lever, Ashby, SmartRecruiters, Workable.
  No aggregator scraping; Workday deferred.
- **Data in git, site as artifact** — `data/*.json` commits are the audit trail; `site/`
  is deployed to Pages and never committed.
- **Pay-first filtering** — company vetting record + published-base enforcement at ₹50L;
  total-only comp kept above floor with `base unverified`; evidence accrues in
  `comp-evidence.json`.
- **Two-strike archiving** — closed roles leave the active list after 2 consecutive
  successful board fetches without them; failed/zero-job fetches never archive.
- **Rules-first classification** with a cached GitHub Models fallback bounded to ~40
  titles/run; no secrets anywhere (`GITHUB_TOKEN` only).

## Task List

### Phase 1 — Foundation

- [x] T1: Repo scaffold + GitHub repo + Pages enabled
- [x] T2: `companies.json` draft with pay vetting + validator

#### Checkpoint A: Foundation
- [x] Repo pushed; Pages build source = GitHub Actions
- [x] Companies validator passes
- [x] **User reviewed and signed off the 86-company list (2026-09-26)**

### Phase 2 — Crawl core

- [x] T3: Fetch lib + adapter framework + Greenhouse adapter + crawl CLI skeleton
- [x] T4: Lever + Ashby adapters
- [x] T5: SmartRecruiters + Workable adapters
- [x] T6: Normalizer + geo/senior/pay filters + FX
- [x] T7: Store merge + two-strike archiving + comp evidence + health

#### Checkpoint B: Crawl core
- [x] Full-universe dry run completed: 86/86 boards ok, 12,291 raw → 499 kept, per-company isolation held
- [x] Filter output inspected on real data; archive logic covered by tests
- [x] Proceeded to classification on the user's "continue till end" instruction

### Phase 3 — Classification and site

- [x] T8: Taxonomy rules + tests
- [x] T9: LLM fallback (provider-agnostic, optional after GitHub Models retirement) + cache
- [x] T10: Renderer, templates, feeds, no-JS fallback

#### Checkpoint C: Site
- [x] Live-page QA (Playwright + Jev): Backend preset filter → "37 of 470 roles shown", first row "Senior Software Engineer - Backend"
- [x] Archive page renders; 390px width has no horizontal overflow (dark mode not visually verified)
- [x] Proceeded to automation on the user's "continue till end" instruction

### Phase 4 — Automation

- [x] T11: `crawl.yml` (cron, dry-run/manual inputs, commit, Pages deploy)
- [x] T12: `ci.yml` + replay harness against golden store diffs
- [x] T13: Health auto-issues + `verify-companies.mjs`
- [x] T14: README/methodology + first live run review + handover

### Checkpoint D: Complete
- [x] First live run green (manual dispatch 36228317655): page live at https://xpressabhi.github.io/job-radar/ with 470 roles; archive page renders (nothing closed yet); degraded path covered by tests
- [ ] Portfolio nav link decision (separate follow-up)
- [x] All acceptance criteria met; ready for review

### Phase 5 — Optional personal layer (after v1)

- [x] T15: Deterministic local shortlist (`personal-rank.mjs`) shipped; Jev eligibility/fit pass documented as the pending follow-up (needs `TYPESAFE_API_KEY` + confirmed judge interface)

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| ATS endpoints drift (Workable/Workday community endpoints) | Med | Per-adapter fixture tests; fail-soft adapters; health issues; Workday deferred to phase 2 |
| GitHub Actions IPs blocked by some legacy tenants | Med | Tolerate + surface in health; `workflow_dispatch` can rerun locally; never silent |
| GitHub Models unavailable/rate-limited | Low | Rules-only fallback; cache; `needsClassify` retry next run |
| Pay vetting wrong for a company | Med | Sources + dates recorded; observed-posting evidence accrues; user review; conservative FX |
| Strict filters yield too few roles | Med | Start ~70 companies; tune tokens from first runs; grow list from health reports |
| Company list decay (M&A, board moves) | Low | Auto-issues after 3 failed runs; `verify-companies` table |
| `jobs.json` growth | Low | Single file until >5MB, then split archive by year |
| Daily commit noise | Low | Dedicated repo; data-only commits; commit skipped when unchanged |

## Open Questions

- None blocking for v1. Portfolio nav link deferred to a later, separate decision.
- Personal layer: standalone `personal-rank.mjs` vs. teaching the job-finder skill to consume
  `jobs.json` as a source — decide at T15.

---

## Follow-up: Forkable configuration (2026-09-26)

Design: `docs/superpowers/specs/2026-09-26-configurable-job-radar-design.md`; tasks
T16–T25 in `tasks/todo.md`. The upstream India instance stays the checked-in default; its
data files are migrated to the new schema along the way.

### Phase 6 — Config + money foundation

- [x] T16: Config module (generic defaults + sparse override + validation), repo
  `data/config.json` migration, pinned replay config
- [x] T17: Money module (annual base-currency amounts, display formatting, legacy detection)

#### Checkpoint E: Config foundation
- [x] Full suite + replay green with unchanged behavior (golden untouched by T16/T17)
- [x] `npm run validate:config` green on the migrated repo config

### Phase 7 — Pipeline adoption

- [x] T18: Pay pipeline switch — filters/store emit `pay.baseMin/baseMax/vettedMin`;
  evidence write-back migration; tolerant accessors keep consumers working
- [x] T19: Filter genericization — config-driven seniority/geography/title cleanup;
  `location.scope` rename (`located | remote_home | remote_global`)
- [x] T20: Renderer, templates, branding, about copy; per-fork Pages URL derivation
- [x] T21: Companies schema (optional vetting, free-form tier, `location`), validator,
  upstream `data/companies.json` migration

#### Checkpoint F: Pipeline adoption
- [x] Full suite + deliberately refreshed golden green
- [x] Dry-run sanity: drop reasons/counts plausible vs last run; India render diff reviewed
- [x] `npm run validate:companies` green in strict upstream mode

### Phase 8 — Fork tooling

- [x] T22: `npm run add-company` — ATS detection from URL/slug, live verify, append entry
- [x] T23: `npm run setup` — interactive wizard (`--yes`, `--dry-run`, `--data-dir`)

#### Checkpoint G: Fork tooling
- [x] Simulated fork in a temp data dir: setup writes valid config/companies; add-company
  dry-run detects boards; generic-default render contains no upstream URLs
- [x] Existing personal files are backed up, never silently overwritten

### Phase 9 — Docs, automation, migration

- [x] T24: README rewrite + `docs/configuration.md` + workflow bot identity +
  CI `validate:config`
- [x] T25: Upstream parity and production verification (dry-run dispatch → live run →
  Pages), fresh-fork smoke test, completion log

#### Checkpoint H: Complete
- [x] Upstream CI and nightly crawl green; live India site unchanged
- [x] Fresh-fork path simulated end-to-end; all spec success criteria met
- [x] Ready for review

## Follow-up Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Field-shape migration (pay/scope) raced by the live nightly crawl | Med | Tolerant readers for legacy fields; write-back on next crawl; both shapes covered in tests; dry-run parity before dispatch |
| Scope/pay renames ripple through tests and the golden store | Low | One deliberate golden refresh per shape change; replay pinned to fixture config |
| Wizard overwrites personal data on the upstream repo | Med | Backups by default, `--dry-run`, explicit confirmation prompts |
| Per-fork URL/UA derivation differs between Actions and local runs | Low | Resolution-order unit tests with env/remote stubs; remote dry-run dispatch before production |
| Currency change silently invalidates existing vetting amounts | Low | `validate:config` and wizard warnings; docs state vetting is denominated in `pay.currency` |

## Follow-up Open Questions

- None blocking. Optional: run the fresh-fork walkthrough on a throwaway public repo before
  announcing forkability.
- Existing v1 follow-ups (portfolio nav link, dark mode check, Jev pass, Workday adapter,
  company-band upgrades) are unchanged.
