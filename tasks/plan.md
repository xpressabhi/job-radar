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
