# job-radar

Daily crawl of **senior+ engineering roles in India** (or remote-India) at companies **vetted
to pay top of market** → a static page, an archive of closed roles, and JSON/RSS feeds.

- **Live page:** https://xpressabhi.github.io/job-radar/
- **Design spec:** `docs/superpowers/specs/2026-09-26-job-radar-design.md`
- **Plan / task list:** `tasks/plan.md` · `tasks/todo.md`

## The rule

- **Companies** must be vetted at ≥₹20L base generally and **≥₹50L base at senior level in
  India**. Bands live in `data/companies.json` with sources and dates; they are refined by
  pay data observed in real postings (`data/comp-evidence.json`).
- **Roles** must be senior+ engineering titles (`Senior`, `Staff`, `Principal`, `Lead`,
  `Architect`, `Head of`, `Director`, `EM`, `VP`). Where pay is published, the band's
  **lower bound** must clear ₹50L base. Equity and bonus never count. Unlabeled titles
  ("Member of Technical Staff") pass only at frontier-AI companies, flagged `tier-assumed`.
- **Geography:** India-located roles, remote-India roles, and unrestricted-remote roles
  (flagged "verify eligibility"). Roles restricted to other regions are excluded.
- **Freshness:** a role leaves the active list after **two consecutive successful crawls**
  without it, then lives on in the archive. Failed crawls and zero-result boards never
  remove anything. Returning roles are reopened.

## How it works

```
GitHub Actions (daily 01:30 UTC / 07:00 IST, or manual dispatch)
  crawl.mjs    → ATS adapters (Greenhouse, Lever, Ashby, SmartRecruiters, Workable)
               → filters: engineering+seniority → geography → pay
               → classification: rules taxonomy, GitHub Models fallback for misses
               → merge into data/jobs.json (firstSeen/lastSeen/misses, two-strike archive)
               → comp evidence + board health
  render.mjs   → site/: index.html, archive.html, jobs.json, feed.xml
  workflow     → commits data only, deploys the site as a Pages artifact
```

No runtime dependencies and no required secrets. Crawling, filtering, classification by
rules, rendering, and deployment all run on the built-in `GITHUB_TOKEN`. An optional
`LLM_API_KEY` secret (plus `LLM_API_BASE_URL` / `LLM_MODEL` repository variables) enables
the provider-agnostic LLM classification fallback for ambiguous titles — GitHub Models,
which used to serve this keylessly, was retired on 2026-07-30.

To enable the fallback: add the secret `LLM_API_KEY` and the variables
`LLM_API_BASE_URL` (e.g. any OpenAI-compatible endpoint) and `LLM_MODEL`. Without them the
crawler stays rules-only and retries ambiguous titles on later runs.

## Commands

```bash
npm test                      # unit tests (no network)
npm run replay                # offline pipeline vs golden store (-- --update-golden to refresh)
npm run validate:companies    # schema + pay-floor validation of the company universe
npm run crawl                 # real crawl: writes data/*.json
npm run crawl:dry             # fetch + filter + merge in memory; writes nothing
node scripts/crawl.mjs --dry-run --company Anthropic --limit 20
npm run render                # build site/ from data/jobs.json
npm run verify:companies      # board health table (ok / empty / blocked / dead)
```

## Data files

| File | Contents |
|---|---|
| `data/companies.json` | Vetted company universe: ATS, slug, tier, India presence, pay vetting (hand-edited) |
| `data/config.json` | Pay floors, FX table (conservative), politeness, archive rules, LLM settings |
| `data/jobs.json` | The job store: active + archived records, run summary |
| `data/comp-evidence.json` | Base-pay observations from real postings (feeds company-band re-vetting) |
| `data/health.json` | Per-company crawl health (consecutive failures, last error) |
| `data/llm-cache.json` | Title classifications from the LLM fallback (never re-queried) |

## Adding a company

1. Verify the board resolves and has postings:
   `node scripts/verify-companies.mjs --company=Slug`.
2. Add an entry to `data/companies.json` with `ats`, `slug`, `tier`, and a `payVetting`
   record (values, `confidence`, `sources` with dates, `verifiedOn`). New entries should
   start at `confidence: "estimate"` unless you have a checked source.
3. `npm run validate:companies` must pass (floors are enforced: general ≥ ₹20L,
   senior ≥ ₹50L).
4. Commit. The crawler picks it up on the next run.

Board failures are self-reporting: after 3 consecutive failed crawls a company gets a
`board-health` issue opened automatically (and closed on recovery).

## Testing

- Unit tests cover the fetch client, all five adapters (real trimmed payloads), title/URL
  normalization, FX and pay parsing, the geo/seniority/pay gates, store merging,
  two-strike archiving, taxonomy, the LLM fallback (mocked), the renderer, and health issues.
- `npm run replay` runs trimmed real board payloads through the entire pipeline offline and
  diffs the resulting store against `tests/golden/store.json` — a rule change that alters
  output fails until the golden is deliberately refreshed.
- CI runs tests + replay + company validation on every push and PR; the nightly crawl is
  the only job that touches the network.

## Notes

- Pay bands in `companies.json` started as conservative tier-based estimates and are
  upgraded to `confidence: "verified"` as real postings publish pay. Estimates are labeled
  honestly on the page ("vetted ≥₹XL base").
- Personal shortlisting (Jev-based ranking against a CV) is a deliberately local-only,
  after-v1 task — see spec §14. Keys never enter this repo or its CI.
