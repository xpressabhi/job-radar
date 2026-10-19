# Age-based auto-archive for stale roles

- **Date:** 2026-10-19
- **Status:** approved
- **Repo:** `github.com/xpressabhi/job-radar`
- **Builds on:** `2026-09-26-configurable-job-radar-design.md` (config model)

## 1. Purpose

A role that an ATS board keeps listing forever currently stays on the active list forever.
This adds an age cutoff: roles older than `crawl.maxAgeDays` are archived automatically,
so the active list reflects genuinely fresh openings.

**Success criteria**

- With `crawl.maxAgeDays: 60`, an active role whose age date is more than 60 days before the
  crawl timestamp is archived in that run with `closedAt = now`.
- With `crawl.maxAgeDays: null` (default), behavior is unchanged.
- Degraded runs archive nothing, including stale roles.
- A stale role that the board keeps listing does not churn between active and archived.

## 2. Decisions (brainstorm record)

| Decision | Choice |
|---|---|
| Age basis | `postedAt` when the board publishes it, otherwise `firstSeen` |
| Config default | `crawl.maxAgeDays: null` (opt-in); this instance sets `60` |
| Reporting | Separate `archivedStale` count alongside the existing `archived` total |

## 3. Config

`scripts/lib/config.mjs`:

- `DEFAULTS.crawl.maxAgeDays: null`.
- `ALLOWED_KEYS.crawl` gains `maxAgeDays`.
- `validateConfig` accepts `null` or an integer ≥ 1; anything else is an error
  (`crawl.maxAgeDays must be null or an integer >= 1`).
- `loadConfig` exposes no legacy alias (the key is new; consumers read `config.crawl`).

`data/config.json` (this instance) sets `"maxAgeDays": 60`.

## 4. Merge behavior (`scripts/lib/store.mjs`)

`mergeResults` keeps its current merge and two-strike logic, then runs an age pass inside
the existing `if (archive)` block:

1. For each job still `active`, compute its age date: `postedAt` if set, else `firstSeen`.
2. If the date parses and is strictly older than `maxAgeDays` before `now`, set
   `status: "archived"`, `closedAt: now`, and increment both `summary.archived` and
   `summary.archivedStale`.
3. Jobs without a parseable date are left active (never archive on missing data).

New postings are inserted before the age pass, so a role first seen today but published
long ago is archived in its first run rather than appearing on the site.

Reopen churn: the existing branch that reactivates an archived record when the board lists
it again only runs for `wasArchived` records. The age pass then re-archives the same role
in the same run when it is still stale. To avoid this, the reactivation branch checks the
age cutoff first: a stale posting updates `lastSeen`/`misses` and keeps `status: "archived"`
without counting as reopened. The age decision lives in one exported helper,
`isStale(job, config, now)`, so merge and tests share it.

Ordering: age archiving runs after the two-strike pass. A job archived by misses is not
counted again as stale (`status` is already `archived`).

## 5. Reporting

- `summary.archivedStale` (integer, always present, `0` when the cutoff is off).
- Crawl log line gains `· stale ${summary.archivedStale}` when the cutoff is configured.
- `site/index.html` and `site/archive.html` coverage gain a `stale` chip only when the run
  archived at least one stale role, mirroring the existing "closed this run" chip.
- The generated "Freshness" about bullet mentions the cutoff when configured
  (`... or after N days since posting`), so the rule is visible on the site.

## 6. Docs and tests

- `docs/configuration.md`: new `crawl.maxAgeDays` row and a sentence on the age basis.
- `README.md`: mention age-based archiving in "How it works" / rules of the instance.
- `tests/store.test.mjs`:
  - cutoff archives a job whose `postedAt` is older than the limit;
  - `firstSeen` fallback applies when `postedAt` is null;
  - `null` cutoff archives nothing;
  - degraded run (`archive: false`) archives nothing;
  - a stale role re-listed by the board stays archived and is not counted as reopened;
  - unparseable/missing dates never archive.
- `tests/config.test.mjs`: default is `null`, `60` round-trips, invalid values are errors.
- `tests/render.test.mjs`: coverage shows the stale chip when `lastRun.archivedStale > 0`.

## 7. Out of scope

- Backfilling `postedAt` for roles whose boards never publish it.
- Deleting old archived records (the archive is intentionally permanent).
- A per-company cutoff or per-track cutoff.
