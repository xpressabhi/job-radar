# Job Radar — track focus (frontend + AI engineering) design spec

- **Date:** 2026-09-26
- **Status:** approved (brainstormed and approved in session `ses_f2179ea2effegmC1ZGVUpW1Xot`)
- **Repo:** `github.com/xpressabhi/job-radar` (this instance)
- **Builds on:** `2026-09-26-configurable-job-radar-design.md`

## 1. Purpose

Focus this Job Radar instance on the two tracks Abhishek is actually hiring for, matching
the two CV variants:

1. **Frontend / frontend-platform** — React, TypeScript, component systems, performance,
   accessibility (frontend-platform CV).
2. **AI engineering** — agents, LLM apps, evals, RAG, MCP, agent UIs (general CV).

Unrelated tracks (backend, data, security, QA, mobile, platform-infra, leadership,
solutions/sales) must be removed from the store and blocked from future crawls.

**Success criteria**

- A role reaches the store only if its **title** matches a frontend or AI track and no
  exclusion pattern (deterministic, config-driven, test-covered).
- The store is pruned to matching roles only; the rendered site reflects the focus.
- The generic defaults are unchanged: a fork without `roles.tracks` behaves exactly as
  before (replay golden untouched).
- The personal layer (job-finder tracker + CV variants) is aligned locally; nothing
  personal is committed to the public repo.

## 2. Decisions (brainstorm record)

| Decision | Choice |
|---|---|
| Filter method | **Titles decide** — title patterns are the gate (category classification is too noisy from descriptions) |
| Scope | Frontend + AI engineering only; no fullstack/FDE/solutions/platform tracks |
| Leadership | EM/director/head/VP roles excluded (candidate is a Staff IC) |
| Architect | Excluded (candidate declined solutions/architect-style client-facing roles) |
| Product Engineer | Included (target title "Senior/Staff Product Engineer (AI SaaS)") |
| Store history | Active **and** archived entries pruned; evidence/health untouched |
| Tracker history | Old `shown` roles judged with Jev `triage`; off-track marked `not_interested`; uncertain goes to a review report |
| CV variants | Stored locally only (`~/.job-search/cv/`), referenced from the profile |

## 3. Config shape — `roles.tracks`

```jsonc
"roles": {
  "tracks": {
    "includePatterns": [ { "label": "frontend", "pattern": "\\bfront[- ]?end\\b" }, … ],
    "excludePatterns": [ { "label": "solutions/sales", "pattern": "\\b(?:solutions?|sales|…)\\b" }, … ]
  }
}
```

Semantics (mirrors `roles.seniority`):

- Exclusions are checked first; a title matching an exclusion is dropped with the label
  as the drop reason.
- If `includePatterns` is empty/absent, the gate is off (generic default).
- Otherwise the title must match at least one include pattern to be kept.
- Applied to the cleaned title in `applyFilters` (after the engineering + seniority
  gates, before geography/pay) and in the crawl detail-fetch pre-check.
- Raw regexes, case-insensitive, validated by `validate:config`.

Pattern sets (this instance):

- **Include:** frontend, react, next.js, web engineer/developer/platform, ui engineer/
  developer, design engineer/systems, product engineer, ai, ml/machine learning/deep
  learning, llm(s), genai/generative ai, agent(s|ic), rag, evals/evaluation, mcp/model
  context protocol, nlp, applied ai/ml.
- **Exclude:** leadership; solutions/sales/support/partner; analyst/analytics/consulting/
  recruiting/people/marketing/account/advocate/evangelist; architect; research/model
  training; infra/sre/devops/k8s/distributed/networking/storage/databases/observability/
  performance/kernels/deployment; security/compliance/penetration/qa/quality/test/sdet;
  mobile/ios/android/react native/flutter; backend/sap/salesforce/zuora/data/search/
  scalability.

## 4. Store cleanup

Apply the gate to `data/jobs.json` (active + archived): keep matching roles, drop the
rest. Expected: 465 active → ~32, 5 archived → 0 (verified in the dry simulation before
implementation). `comp-evidence.json` and `health.json` are observation logs, not job
lists — untouched.

## 5. Site copy

`site.title`, `tagline`, `description` and the about bullets state the two-track focus
(frontend React/TypeScript + AI engineering), keeping the pay/geography rules.

## 6. Personal layer (local only)

- `~/.job-search/cv/`: both PDFs + extracted text; profile gains `cv.variants`
  (general, frontend-platform); canonical `cv.path` stays the general variant.
- `targets.titles`/`targets.skills` narrowed to the two tracks; the channel notes are
  updated (no full-stack/FDE/solutions/platform targets).
- Tracker purge: `jev.mjs triage` (location/mode stripped so the track judgment is
  independent of the onsite gate) over the 462 `shown` roles against the narrowed
  profile → `track_ok ≤ 0.3` marked `not_interested` (note: track purge); 0.3–0.7
  saved to a tracker report for review; applied/rejected/expired untouched.
- Two local rank profiles (frontend-platform, ai-agent) feed `personal-rank.mjs`
  (output: `output/shortlist-frontend.md`, `output/shortlist-ai.md`); an optional Jev
  fit pass refines them.

## 7. Out of scope

- Classification/taxonomy changes (categories stay built-in; the gate is independent).
- Rewriting the tracker's applied/rejected history.
- Weekly re-sweeps or new companies.
