# Age-based Auto-archive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Archive roles older than `crawl.maxAgeDays` (60 in this instance) automatically during a crawl.

**Architecture:** A config key (`crawl.maxAgeDays`, default `null` = off) feeds a new exported `isStale(job, config, now)` helper in `scripts/lib/store.mjs`. `mergeResults` uses it in two places: to stop a stale posting from being reactivated, and in an age pass after the existing two-strike archive that archives still-active stale jobs. The crawler logs a separate stale count; the renderer shows it and mentions the cutoff in the generated Freshness bullet.

**Tech Stack:** Node.js ≥20, ESM, `node:test` + `node:assert/strict`, zero runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-10-19-archive-older-roles-design.md`

## Global Constraints

- Zero runtime dependencies; do not add packages.
- `crawl.maxAgeDays` default is `null` (off). This repo's `data/config.json` sets `60`.
- Age basis: `postedAt` when present, else `firstSeen`. Missing/unparseable dates never archive.
- Archiving is suspended entirely when the crawl is degraded (`mergeResults({ archive: false })`).
- `summary.archived` stays the total archived count; `summary.archivedStale` is the subset archived by age and is always a number.
- No `reopened` count for a stale role the board keeps listing.
- Follow existing style: 2-space indent, double quotes, named exports, comments only where intent is non-obvious.

## Review Focus

- A board that publishes no `postedAt` at all (e.g. Greenhouse list payloads before detail fetch): expect `firstSeen` to drive the cutoff and no crash.
- A job record with `postedAt: "nonsense"` or `firstSeen` missing: expect it to stay active forever rather than be archived.
- A role archived by the age cutoff that the board lists again: expect it to remain archived, `closedAt` unchanged, `lastSeen` updated, `reopened` not incremented.
- A degraded run that coincides with stale roles: expect zero archives and `archivedStale: 0`.
- A role published long ago but first seen today: expect it to be archived in its first run (not shown on the site for a day).

---

### Task 1: Add `crawl.maxAgeDays` config key

**Files:**
- Modify: `scripts/lib/config.mjs` (`DEFAULTS.crawl`, `ALLOWED_KEYS.crawl`, `validateConfig`)
- Modify: `data/config.json` (`crawl.maxAgeDays: 60`)
- Test: `tests/config.test.mjs`

**Interfaces:**
- Consumes: nothing new.
- Produces: `config.crawl.maxAgeDays: number | null`, validated. Later tasks read `config.crawl.maxAgeDays` directly (no legacy alias).

- [ ] **Step 1: Write the failing tests**

Add to `tests/config.test.mjs`:

```js
test("crawl.maxAgeDays defaults to null and round-trips a number", () => {
  assert.equal(loadConfig({}).crawl.maxAgeDays, null);
  assert.equal(loadConfig({ crawl: { maxAgeDays: 60 } }).crawl.maxAgeDays, 60);
  assert.equal(loadConfig(repoRaw, { env: {} }).crawl.maxAgeDays, 60, "this instance opts in");
});

test("validator accepts only null or an integer >= 1 for crawl.maxAgeDays", () => {
  const ok = validateConfig(loadConfig({ location: { country: "India" }, crawl: { maxAgeDays: null } }));
  assert.equal(ok.errors.length, 0, ok.errors.join("\n"));
  for (const bad of [0, -5, 1.5, "60"]) {
    const res = validateConfig(loadConfig({ location: { country: "India" }, crawl: { maxAgeDays: bad } }));
    assert.match(res.errors.join("\n"), /crawl\.maxAgeDays must be null or an integer >= 1/, `rejects ${JSON.stringify(bad)}`);
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/config.test.mjs`
Expected: FAIL — `crawl.maxAgeDays` is `undefined` / no validator error.

- [ ] **Step 3: Implement the config key**

In `scripts/lib/config.mjs`:

1. `DEFAULTS.crawl` gains `maxAgeDays: null` (put it after `archiveMisses`).
2. `ALLOWED_KEYS.crawl` gains `"maxAgeDays"`.
3. In `validateConfig`, after the `archiveMisses` check:

```js
if (crawl.maxAgeDays != null && (!Number.isInteger(crawl.maxAgeDays) || crawl.maxAgeDays < 1)) {
  errors.push("crawl.maxAgeDays must be null or an integer >= 1");
}
```

In `data/config.json`, add `"maxAgeDays": 60` to `crawl` after `"archiveMisses": 2`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/config.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/config.mjs data/config.json tests/config.test.mjs
git commit -m "feat(config): add crawl.maxAgeDays (60 in this instance)"
```

---

### Task 2: Age-based archiving in the store merge

**Files:**
- Modify: `scripts/lib/store.mjs`
- Test: `tests/store.test.mjs`

**Interfaces:**
- Consumes: `config.crawl.maxAgeDays` from Task 1.
- Produces:
  - `export function isStale(job, config, now): boolean` — true when `config.crawl.maxAgeDays` is a positive integer, the job's age date (`postedAt` ?? `firstSeen`) parses, and it is strictly older than the cutoff relative to `now`.
  - `mergeResults(...)` returns the same shape; `summary.archivedStale: number` is added.

- [ ] **Step 1: Write the failing tests**

Add to `tests/store.test.mjs` (reuse the existing `posting`/`result` helpers):

```js
const agedConfig = { archiveMisses: 2, crawl: { maxAgeDays: 60 } };
const NOW_MS = "2026-09-26T02:00:00.000Z";

test("isStale uses postedAt, falls back to firstSeen, and ignores bad dates", () => {
  assert.equal(isStale({ postedAt: "2026-07-01", firstSeen: NOW_MS }, agedConfig, NOW_MS), true);
  assert.equal(isStale({ postedAt: "2026-09-01", firstSeen: "2026-01-01T00:00:00.000Z" }, agedConfig, NOW_MS), false);
  assert.equal(isStale({ postedAt: null, firstSeen: "2026-07-01T00:00:00.000Z" }, agedConfig, NOW_MS), true);
  assert.equal(isStale({ postedAt: "nonsense", firstSeen: "2026-07-01T00:00:00.000Z" }, agedConfig, NOW_MS), false);
  assert.equal(isStale({ postedAt: null, firstSeen: null }, agedConfig, NOW_MS), false);
  assert.equal(isStale({ postedAt: "2020-01-01" }, config, NOW_MS), false, "null cutoff disables the rule");
});

test("the age cutoff archives an old active job and counts it separately", () => {
  const old = posting({ postedAt: "2026-07-01" });
  const { store, summary } = mergeResults({ store: emptyStore(), results: [result([old])], config: agedConfig, now: NOW_MS });
  assert.equal(store.jobs[0].status, "archived");
  assert.equal(store.jobs[0].closedAt, NOW_MS);
  assert.equal(summary.archived, 1);
  assert.equal(summary.archivedStale, 1);
});

test("a job first seen long ago but never posted is archived on firstSeen", () => {
  const first = mergeResults({ store: emptyStore(), results: [result([posting()])], config: agedConfig, now: "2026-07-01T02:00:00.000Z" }).store;
  const later = mergeResults({ store: first, results: [result([posting()])], config: agedConfig, now: NOW_MS });
  assert.equal(later.store.jobs[0].status, "archived");
  assert.equal(later.summary.archivedStale, 1);
});

test("no cutoff archives nothing and archivedStale is zero", () => {
  const { store, summary } = mergeResults({ store: emptyStore(), results: [result([posting({ postedAt: "2020-01-01" })])], config, now: NOW_MS });
  assert.equal(store.jobs[0].status, "active");
  assert.equal(summary.archivedStale, 0);
});

test("degraded runs never archive stale jobs", () => {
  const old = posting({ postedAt: "2026-07-01" });
  const { store, summary } = mergeResults({ store: emptyStore(), results: [result([old])], config: agedConfig, now: NOW_MS, archive: false });
  assert.equal(store.jobs[0].status, "active");
  assert.equal(summary.archivedStale, 0);
});

test("a stale role the board keeps listing stays archived without counting as reopened", () => {
  const old = posting({ postedAt: "2026-07-01" });
  let store = mergeResults({ store: emptyStore(), results: [result([old])], config: agedConfig, now: NOW_MS }).store;
  assert.equal(store.jobs[0].status, "archived");
  const again = mergeResults({ store, results: [result([old])], config: agedConfig, now: LATER });
  assert.equal(again.store.jobs[0].status, "archived");
  assert.equal(again.store.jobs[0].closedAt, NOW_MS, "closedAt is not rewritten");
  assert.equal(again.store.jobs[0].lastSeen, LATER);
  assert.equal(again.summary.reopened, 0);
  assert.equal(again.summary.archivedStale, 0);
});

test("a fresh role the board lists after an age archive reopens normally", () => {
  const old = posting({ postedAt: "2026-07-01" });
  let store = mergeResults({ store: emptyStore(), results: [result([old])], config: agedConfig, now: NOW_MS }).store;
  const fresh = posting({ postedAt: "2026-09-25" });
  const back = mergeResults({ store, results: [result([fresh])], config: agedConfig, now: LATER });
  assert.equal(back.store.jobs[0].status, "active");
  assert.equal(back.summary.reopened, 1);
});
```

Update the import line to include `isStale`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/store.test.mjs`
Expected: FAIL — `isStale` is not exported; `summary.archivedStale` is undefined.

- [ ] **Step 3: Implement `isStale` and the age pass**

In `scripts/lib/store.mjs`:

1. Add the helper near the top:

```js
/** True when the job's age date (postedAt ?? firstSeen) is older than crawl.maxAgeDays. */
export function isStale(job, config = {}, now) {
  const days = config.crawl?.maxAgeDays;
  if (!Number.isInteger(days) || days < 1) return false;
  const date = job.postedAt || job.firstSeen;
  if (!date) return false;
  const age = new Date(date).getTime();
  const at = new Date(now).getTime();
  if (Number.isNaN(age) || Number.isNaN(at)) return false;
  return at - age > days * 24 * 60 * 60 * 1000;
}
```

2. Add `archivedStale: 0` to the `summary` object.

3. In the existing-record branch, replace the unconditional reactivation with a staleness guard:

```js
if (wasArchived) {
  if (isStale(existing, config, now)) {
    // The board still lists it, but it is past the cutoff: refresh without reopening.
    existing.status = "archived";
  } else {
    existing.status = "active";
    existing.reopenedAt = now;
    existing.closedAt = null;
    summary.reopened++;
  }
}
```

Note `existing.closedAt` is preserved in the stale case; `Object.assign` above already refreshed the other fields and `lastSeen` is set right after.

4. In the `if (archive)` block, after the two-strike loop:

```js
if (config.crawl?.maxAgeDays != null) {
  for (const job of jobs) {
    if (job.status !== "active") continue;
    if (!isStale(job, config, now)) continue;
    job.status = "archived";
    job.closedAt = now;
    summary.archived++;
    summary.archivedStale++;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/store.test.mjs`
Expected: PASS, including all pre-existing store tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/store.mjs tests/store.test.mjs
git commit -m "feat(store): archive roles older than crawl.maxAgeDays"
```

---

### Task 3: Surface the stale count in crawl output and the site

**Files:**
- Modify: `scripts/crawl.mjs` (log line)
- Modify: `scripts/render.mjs` (`coverageHtml`, `aboutItems`)
- Test: `tests/render.test.mjs`

**Interfaces:**
- Consumes: `summary.archivedStale` and `store.lastRun.archivedStale` from Task 2; `config.crawl.maxAgeDays` from Task 1.
- Produces: `coverageHtml` renders a `<span><strong>N</strong> archived as stale</span>` chip when `lastRun.archivedStale > 0`; `aboutItems` appends the cutoff to the Freshness bullet when configured.

- [ ] **Step 1: Write the failing tests**

Add to `tests/render.test.mjs`:

```js
test("coverage shows the stale chip only when the run archived stale roles", () => {
  const base = JSON.parse(JSON.stringify(store));
  base.lastRun.archivedStale = 3;
  const html = renderSite({ store: base, config, now: "2026-09-26T02:00:00.000Z" })["index.html"];
  assert.match(html, /<strong>3<\/strong> archived as stale/);

  const quiet = renderSite({ store, config, now: "2026-09-26T02:00:00.000Z" })["index.html"];
  assert.ok(!quiet.includes("archived as stale"), "no chip when zero");
});

test("the generated Freshness bullet names the age cutoff when configured", () => {
  const withCutoff = renderSite({
    store: emptyStore(),
    config: { ...config, crawl: { maxAgeDays: 60 } },
    now: "2026-09-26T02:00:00.000Z",
  })["index.html"];
  assert.match(withCutoff, /or 60 days after posting/);

  const without = renderSite({ store: emptyStore(), config, now: "2026-09-26T02:00:00.000Z" })["index.html"];
  assert.ok(!without.includes("days after posting"), "no cutoff mentioned when off");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/render.test.mjs`
Expected: FAIL — no stale chip, no cutoff sentence.

- [ ] **Step 3: Implement the rendering and log changes**

In `scripts/render.mjs`:

1. In `coverageHtml`, after the `run.archived` bit, add:

```js
run.archivedStale ? `<span><strong>${run.archivedStale}</strong> archived as stale</span>` : "",
```

2. In `aboutItems`, the Freshness item becomes conditional. Replace the current `items.push(...)` for freshness with:

```js
const maxAge = config.crawl?.maxAgeDays;
items.push(
  `<strong>Freshness:</strong> crawled daily from public ATS boards. A role leaves the active list after two consecutive successful crawls without it${
    Number.isInteger(maxAge) ? `, or ${maxAge} days after posting` : ""
  }, and lives on in the archive. Failed crawls never remove anything.`,
);
```

In `scripts/crawl.mjs`, extend the summary log line (the one starting `boards ok`) so it appends `· stale ${summary.archivedStale}` only when `config.crawl?.maxAgeDays != null`:

```js
const staleNote = config.crawl?.maxAgeDays != null ? ` · stale ${summary.archivedStale}` : "";
io.log(`\nboards ok ${summary.boardsOk}/${selected.length} · raw ${rawTotal} · kept ${keptTotal} · new ${summary.new} · archived ${summary.archived}${staleNote} · reopened ${summary.reopened} · duplicates ${summary.duplicates}`);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/render.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/crawl.mjs scripts/render.mjs tests/render.test.mjs
git commit -m "feat(site): show stale-archive count and cutoff in coverage"
```

---

### Task 4: Docs, full verification, and site regen

**Files:**
- Modify: `docs/configuration.md` (`crawl` table)
- Modify: `README.md` (rules sentence + config highlight)
- Test: existing suites (no new tests)

**Interfaces:**
- Consumes: everything above.
- Produces: documentation only.

- [ ] **Step 1: Document the key**

In `docs/configuration.md`'s `crawl` table, add after `archiveMisses`:

```md
| `maxAgeDays` | integer ≥ 1 \| null | `null` | Auto-archive active roles older than this many days. Age is `postedAt` when the board publishes it, otherwise `firstSeen`; roles with no usable date are kept. Suspended on degraded runs |
```

In `README.md`, update the "rules of the upstream instance" paragraph (line ~95-98) to mention: roles are also archived once they are more than 60 days past their posting date.

- [ ] **Step 2: Run the full verification**

```bash
npm test
npm run replay
npm run validate:config
npm run validate:companies
```

Expected: all pass. If `npm run replay` fails because the fixture store now contains stale roles, do **not** update the golden blindly: check that the only diff is age-archived records under `tests/fixtures/config.json` (which does not set `maxAgeDays`, so there should be no diff at all).

- [ ] **Step 3: Verify this instance's data against the cutoff**

```bash
node --input-type=module -e "import { readFileSync } from 'node:fs'; import { loadConfigFile } from './scripts/lib/config.mjs'; import { isStale } from './scripts/lib/store.mjs'; const store = JSON.parse(readFileSync('data/jobs.json', 'utf8')); const cfg = loadConfigFile('data/config.json'); const now = new Date().toISOString(); const stale = store.jobs.filter((j) => j.status === 'active' && isStale(j, cfg, now)); console.log(stale.length, 'active roles past the cutoff'); for (const j of stale) console.log(' -', j.title, '|', j.company, '|', j.postedAt ?? j.firstSeen);"
```

Expected: prints the count and each role. This is a preview only — do not edit `data/jobs.json` by hand; the next `npm run crawl` performs the archive.

- [ ] **Step 4: Render and inspect**

```bash
npm run render
```

Expected: `rendered site/: ...`; open `site/archive.html` and confirm any age-archived roles appear there (after a crawl, not just a render).

- [ ] **Step 5: Commit**

```bash
git add docs/configuration.md README.md
git commit -m "docs: document crawl.maxAgeDays"
```
