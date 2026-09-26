# job-radar

Daily crawl of engineering roles straight from company ATS boards → a static GitHub Pages
site, an archive of closed roles, and JSON/RSS feeds. Zero runtime dependencies, no
required secrets.

The upstream instance tracks senior+ engineering roles in India at employers vetted to pay
top of market: **https://xpressabhi.github.io/job-radar/**. Fork it and it becomes yours —
your country, your currency, your pay floors, your levels, your company list, your Pages.

## Run your own (fork quick start)

1. **Fork** this repo (or clone it) — `git clone https://github.com/<you>/job-radar`.
2. **Set it up:** `npm run setup` walks through site name, home country and cities, remote
   policy, pay currency + floors, and seniority keywords, then writes a sparse
   `data/config.json` (only what differs from built-in defaults) and a starter
   `data/companies.json`. Files it replaces are backed up as `*.bak`.
   Scriptable variants: `npm run setup -- --yes --country Germany --company https://jobs.lever.co/acme`.
3. **Grow the company list:** `npm run add-company -- https://jobs.lever.co/acme` detects the
   ATS (Greenhouse, Lever, Ashby, SmartRecruiters, Workable), checks the board live, and
   appends a validated entry. Bare slugs work with `--ats`.
4. **Sanity-check locally:** `npm run crawl:dry` (fetch + filter, writes nothing), then
   `npm run render` and open `site/index.html`.
5. **Deploy:** push to GitHub, then enable **Settings → Pages → GitHub Actions**. The nightly
   workflow crawls at 01:30 UTC and publishes to `https://<you>.github.io/<repo>/`. RSS and
   canonical links and the crawler `User-Agent` are derived per fork from the repository —
   nothing points at the upstream owner.
6. **Optional:** the LLM fallback for ambiguous titles. Add the secret `LLM_API_KEY` and the
   repository variables `LLM_API_BASE_URL` (any OpenAI-compatible endpoint) and `LLM_MODEL`.
   Without them the crawler stays rules-only and retries ambiguous titles on later runs.

## Configuration

Everything personal lives in two committed data files; code reads them through
`scripts/lib/config.mjs` (built-in defaults deep-merged with your overrides).

| File | Contents |
|---|---|
| `data/config.json` | Sparse override: `site`, `location`, `roles`, `pay`, `crawl`, `llm` |
| `data/companies.json` | The company universe (name, ATS, slug, optional tier/location/pay vetting) |
| `data/jobs.json` | The job store: active + archived records, run summary |
| `data/comp-evidence.json` | Base-pay observations from real postings |
| `data/health.json` | Per-company crawl health |
| `data/llm-cache.json` | Title classifications from the LLM fallback |

Full key reference: [`docs/configuration.md`](docs/configuration.md). Highlights:

- **`location`** — `country`/`countryCode`, `cities` aliases, `acceptRemote`, exclusion lists.
  Home-country matches win; explicit other-region postings are dropped; region-less remote
  roles are kept and flagged "verify eligibility".
- **`pay`** — `enabled`, `currency`, `floorAnnual`, `companyFloorAnnual`, `vettingRequired`,
  `display`, `fxRates`. All amounts are annual in `pay.currency`. `enabled: false` switches
  the floor gate off; `vettingRequired: false` lets companies run without hand-vetted bands.
- **`roles.seniority`** — `includeKeywords`/`excludeKeywords` (simple) and
  `includePatterns`/`excludePatterns`/`skipSeniorPatterns` (regex), plus
  `assumeSeniorForTiers` for flat, senior-by-default titles at labs.
- **Company vetting** is optional enrichment: `payVetting.generalBaseMin` / `.seniorBaseMin`
  are annual amounts in `pay.currency`; when present they must clear the configured floors.
  The upstream instance ships `vettingRequired: true` to keep its bar strict; forks can turn
  that off.

Validate any time: `npm run validate:config` (add `-- --show` to print the effective
config) and `npm run validate:companies`.

## Commands

```bash
npm test                          # unit tests (no network)
npm run replay                    # offline pipeline vs golden store (-- --update-golden to refresh)
npm run setup                     # interactive configuration wizard for forks
npm run add-company -- <url|slug> # detect ATS, verify board, append a company
npm run crawl                     # real crawl: writes data/*.json
npm run crawl:dry                 # fetch + filter + merge in memory; writes nothing
node scripts/crawl.mjs --dry-run --company Anthropic --limit 20
npm run render                    # build site/ from data/jobs.json
npm run validate:config           # effective-config validation (-- --show prints it)
npm run validate:companies        # schema + pay-floor validation of the company universe
npm run verify:companies          # board health table (ok / empty / blocked / dead)
```

## How it works

```
GitHub Actions (daily 01:30 UTC, or manual dispatch)
  crawl.mjs    → ATS adapters (Greenhouse, Lever, Ashby, SmartRecruiters, Workable)
               → config-driven gates: engineering title → seniority → geography → pay
               → classification: rules taxonomy, optional LLM fallback for misses
               → merge into data/jobs.json (firstSeen/lastSeen/misses, two-strike archive)
               → comp evidence + board health
  render.mjs   → site/: index.html, archive.html, jobs.json, feed.xml
  workflow     → commits data only, deploys the site as a Pages artifact
```

Rules of the upstream instance (all configurable): companies vetted at ≥₹20L base
generally and ≥₹50L base at senior level in India; senior+ engineering titles only; India
locations, remote-India, and unrestricted remote (flagged); a role leaves the active list
after two consecutive successful crawls without it, then lives in the archive.

## Testing

- Unit tests cover the config loader/validator, money conversion/formatting and legacy
  migration, all five adapters (real trimmed payloads), title/URL normalization, geo/
  seniority/pay gates, store merging, archiving, taxonomy, the LLM fallback (mocked), the
  renderer (including per-fork URL derivation), the setup wizard, and add-company.
- `npm run replay` runs trimmed real board payloads through the pipeline offline against a
  **pinned fixture config** (`tests/fixtures/config.json`), so personalizing your config
  never breaks the tests, and diffs against `tests/golden/store.json`.
- CI runs tests + replay + `validate:config` + `validate:companies` on every push and PR;
  the nightly crawl is the only job that touches the network.

## Upgrading a fork

The code is generic; your settings live only in `data/config.json` and
`data/companies.json`. Pulling upstream updates shouldn't conflict unless the config
*shape* changes — new keys are added to defaults first, so your sparse override keeps
working. `npm run setup` re-run is safe: it backfills and rewrites the override file with
backups.
