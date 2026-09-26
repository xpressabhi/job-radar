# Job Radar — configurable fork design spec

- **Date:** 2026-09-26
- **Status:** approved (brainstormed and approved in session `ses_f2332bbe5ffeceG5nMQxHpbZmw`)
- **Repo:** `github.com/xpressabhi/job-radar` (the India instance stays the checked-in default)
- **Builds on:** `2026-09-26-job-radar-design.md` (original design)

## 1. Purpose

Make job-radar forkable. Anyone cloning or forking it should be able to run one setup
command, point it at their own country, currency, pay floors, seniority levels, branding,
and company list, and deploy their **own** GitHub Pages site — with no reference to the
upstream owner anywhere in the output.

The upstream repo keeps working unchanged as Abhishek's India instance; its data files are
migrated to the new schema as part of this work.

**Success criteria**

- A fork with a fresh `data/config.json` + `data/companies.json` crawls, renders, and
  deploys to `https://<fork-owner>.github.io/<repo>/` with correct RSS/canonical/meta links
  and a crawler `User-Agent` pointing at the fork, without editing any `.mjs` file.
- `npm test`, `npm run replay`, `npm run validate:companies`, `npm run validate:config` are
  green both upstream and after arbitrary fork config changes (replay is pinned to its own
  fixture config).
- Upstream parity: with the migrated India config, a dry-run crawl keeps the same roles and
  the rendered site differs only where the design intends.
- Zero runtime dependencies and no required secrets are preserved.

## 2. Decisions (brainstorm record)

| Decision | Choice |
|---|---|
| Fork experience | Upstream personal setup stays the checked-in default; forkers customize in place guided by setup/docs |
| Config scope | Any region / currency / seniority level; domain stays engineering (taxonomy stays built-in) |
| Company pay vetting | Optional enrichment; `pay.vettingRequired` keeps upstream CI strict; pay gate can be switched off |
| Setup experience | Interactive `npm run setup` wizard + `npm run add-company` helper + rewritten README |
| Upgrade path | Code ships generic defaults; `data/config.json` is a sparse override deep-merged over them |
| Pages | Every fork deploys to its own GitHub Pages; site URL and User-Agent are derived per-fork, never hardcoded |

## 3. Config model

`scripts/lib/config.mjs` exports:

- `DEFAULTS` — generic, inert baseline: no country/cities, `pay.currency: "USD"` with zero
  floors, `vettingRequired: false`, current politeness values, built-in excluded-region
  terms/country codes, built-in seniority regex patterns, built-in FX rate table.
- `loadConfig(fileConfig)` — deep merge over `DEFAULTS`; compiles keyword/pattern strings
  into regexes; strips the home country from the exclusion lists.
- `validateConfig(effective)` — human-readable errors: required `location.country` (crawl
  refuses to run without it), `pay.currency` when the gate is enabled, regexes compile,
  display settings sane, FX coverage for `pay.currency`, city aliases unique.

Effective shape (the India instance's `data/config.json` after migration):

```jsonc
{
  "$comment": "Sparse override over built-in defaults — see docs/configuration.md",
  "site":  { "name": "Job Radar", "tagline": "…", "description": "…" },        // url optional override
  "location": { "country": "India", "countryCode": "IN", "acceptRemote": true,
                "cities": { "bengaluru": "Bengaluru", "bangalore": "Bengaluru" /* … */ } },
  "roles": { "seniority": { "assumeSeniorForTiers": ["frontier-ai"] } },
  "pay":   { "enabled": true, "currency": "INR", "floorAnnual": 5000000,
             "companyFloorAnnual": 2000000, "vettingRequired": true,
             "display": { "symbol": "₹", "divisor": 100000, "suffix": "L", "decimals": 1 },
             "fxRates": { "USD": 87 /* … */ }, "fxNote": "…" },
  "crawl": { "requestDelayMs": 1000, "timeoutMs": 20000, "retries": 1, "archiveMisses": 2 },
  "llm":   { "maxPerRun": 40 }
}
```

Notes:

- Money floors are **annual amounts in `pay.currency`** (no more implicit INR lakhs).
- `roles.seniority` accepts casual `includeKeywords` / `excludeKeywords` plus advanced raw
  regex `includePatterns` / `excludePatterns`; defaults are today's exact patterns.
- `userAgent` is no longer required in config: the default derives per-fork (see §7).
- `npm run validate:config` checks the effective config; `--show` prints it.
- Unknown keys are ignored but reported by `validate:config` as warnings.

## 4. Filters and money

- **Seniority** (`classifySeniority`): excluded keywords/patterns first, then included
  ones, then `assumeSeniorForTiers` (default `["frontier-ai"]`) → `levelSource: "tier-assumed"`.
  Companies' `tier` becomes free-form.
- **Geography** (`classifyGeography`): driven by `location`. Home-country text or code →
  keep (`located`, or `remote_home` when the posting is remote); remote without any region
  signal → `remote_global` (kept, flagged "verify eligibility"); explicit other-region text
  or code → drop. The hardcoded India city map and other-country exclusion lists move into
  config defaults/overrides.
- **Scope rename:** `location.indiaScope` → `location.scope` with values
  `located | remote_home | remote_global`; migrated in data and updated in renderer/tests.
- **Title cleanup:** the trailing-location strip in `normalize.mjs` becomes config-driven
  (matches configured cities + country label instead of a hardcoded India regex).
- **Money** (`scripts/lib/money.mjs`): published bands are annualized and converted into
  `pay.currency` via `pay.fxRates`. Stored pay becomes
  `{ published, currency, raw, totalOnly, baseMin, baseMax, vettedMin }` (annual, base
  currency). `formatMoney` renders per `pay.display` (`₹70L` for INR lakhs, `$185,000`
  otherwise). `pay.enabled: false` removes the gate.
- **Migration:** tolerant readers convert legacy fields (`baseMinLpa` × 100000,
  `seniorBaseMinLpa` → `seniorBaseMin`, evidence fields likewise) on load; the next crawl
  write-back persists the new shape. Renderer and `personal-rank.mjs` read via the same
  helpers.

## 5. Company schema

```jsonc
{
  "name": "Airbnb",
  "ats": "gh",
  "slug": "airbnb",
  "careersUrl": "https://…",          // optional
  "tier": "big-tech",                 // free-form, optional
  "location": { "offices": [], "remoteOk": true, "note": "…" },   // replaces `india`
  "payVetting": {                     // optional unless pay.vettingRequired
    "generalBaseMin": 3000000,        // annual, pay.currency
    "seniorBaseMin": 7000000,
    "confidence": "estimate",
    "sources": ["…"],
    "verifiedOn": "2026-09-26",
    "notes": "…"
  },
  "enabled": true
}
```

`validate-companies.mjs`: tier enum dropped; `location` optional (validated when present);
`payVetting` validated only when present — but then its amounts must clear
`companyFloorAnnual` / `floorAnnual` — or required for enabled companies when
`pay.vettingRequired` is true (upstream keeps it true). Vetting amounts are denominated in
`pay.currency`; changing the currency requires re-vetting (the wizard warns).

## 6. Setup wizard and add-company

- `npm run setup` (`scripts/setup.mjs`, `node:readline/promises`, zero deps):
  interactive sections — site identity → location (country/code, city aliases, remote
  policy) → pay (enabled, currency, floors, display, FX) → levels → companies (import a
  comma-separated list of careers URLs with live board checks, or keep/replace existing).
  Writes `data/config.json` (sparse override) and `data/companies.json`, backing up
  replaced files; prints next steps (dry crawl → render → enable Pages → optional LLM
  variables). Flags: `--yes` (accept defaults), `--dry-run`, `--data-dir <path>` (used by
  tests). It derives a default `site.url` from the `origin` remote when present.
- `npm run add-company -- <url|slug>` (`scripts/add-company.mjs`): detects the ATS from
  Greenhouse / Lever / Ashby / SmartRecruiters / Workable URL patterns (or accepts
  `--ats` + slug), verifies the board live, prompts for display name, optional tier, and
  optional vetting bands, then appends a valid entry and runs validation. `--dry-run`
  prints the JSON without writing.
- Neither script runs in CI.

## 7. Site, branding, per-fork Pages

- `site.name` / `site.tagline` / `site.description` feed the templates (`{{SITE_NAME}}` etc.);
  the about section is generated from the effective config (country, pay floor and currency
  or "no pay floor", remote policy, levels) instead of hardcoded India/₹ copy.
- Labels: `Remote (${country})` / `Remote (global — verify)`; pay labels via
  `formatMoney`; coverage line formats the configured floor.
- **URL resolution order** for RSS/canonical/meta links: explicit `site.url` →
  `GITHUB_REPOSITORY` env (always set in a fork's Actions run) → `git remote origin` →
  omit the link. No fork output points at the upstream owner.
- Default `User-Agent`: `job-radar/1.0 (+https://github.com/<owner>/<repo>)` derived the
  same way; still overridable via config.
- Workflow bot identity becomes `github-actions[bot]`; README documents enabling Pages and
  the optional LLM variables per fork.

## 8. Tests, CI, docs

- `tests/replay.mjs` loads a **pinned fixture config** (`tests/fixtures/config.json` plus
  fixture companies) instead of the repo config, so fork config edits never break replay;
  golden store refreshed once for the new field shapes.
- `tests/config.test.mjs` becomes merge/validation tests over fixture configs (no personal
  value assertions); new `tests/money.test.mjs`; setup/add-company get non-interactive and
  URL-detection unit tests.
- CI adds `npm run validate:config`; existing steps unchanged.
- README rewritten: fork quick-start first (setup → add companies → Pages → optional LLM),
  configuration summary, commands, then "this repo's live instance" (India defaults).
  Full key reference in `docs/configuration.md`.

## 9. Migration of this repo (the India instance)

1. Rewrite `data/config.json` to the new schema (location India + city map, INR pay floors,
   `vettingRequired: true`); drop `userAgent` (derived per-fork).
2. Migrate `data/companies.json` (`india` → `location`; ×100000 vetting amounts; keep tiers).
3. Migrate `data/jobs.json` and `data/comp-evidence.json` via the tolerant readers; the
   next crawl persists the new shape.
4. Update `render.mjs`, `filters.mjs`, `normalize.mjs`, `store.mjs`, `personal-rank.mjs`,
   templates, and tests to the config-driven signatures.
5. Refresh the golden store.
6. Parity checks: dry-run crawl keeps the same set/counts as before; rendered site visually
   identical for the India instance; live Pages still deploys.

## 10. Out of scope

- Taxonomy categories/tags/quick-filter presets (engineering taxonomy stays built-in).
- Non-engineering domains, multi-profile configs (`--profile`), additional ATS adapters.
- Personal layer behavior beyond field renames (still local-only, still not in CI).
