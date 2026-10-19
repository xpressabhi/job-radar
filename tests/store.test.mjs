import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyStore, mergeResults, isStale, appendCompEvidence, updateHealth, runSummaryLine } from "../scripts/lib/store.mjs";

const config = { archiveMisses: 2 };
const NOW = "2026-09-26T02:00:00.000Z";
const LATER = "2026-09-27T02:00:00.000Z";

const posting = (overrides = {}) => ({
  dedupeKey: "gh:acme:1",
  source: "gh",
  company: "Acme",
  companySlug: "acme",
  jobId: "1",
  title: "Senior Backend Engineer",
  location: { raw: "Bengaluru, India", cities: ["Bengaluru"], mode: null, scope: "located" },
  url: "https://jobs.example.com/1",
  pay: { published: false, vettedMin: 6000000 },
  ...overrides,
});

const result = (postings, extra = {}) => ({
  ok: true,
  company: "Acme",
  companySlug: "acme",
  source: "gh",
  rawCount: postings.length,
  postings,
  ...extra,
});

test("a new posting is inserted with firstSeen/lastSeen and no misses", () => {
  const { store, summary } = mergeResults({ store: emptyStore(), results: [result([posting()])], config, now: NOW });
  assert.equal(summary.new, 1);
  assert.equal(summary.seen, 1);
  assert.equal(store.jobs.length, 1);
  assert.equal(store.jobs[0].firstSeen, NOW);
  assert.equal(store.jobs[0].lastSeen, NOW);
  assert.equal(store.jobs[0].misses, 0);
  assert.equal(store.jobs[0].status, "active");
});

test("re-seeing a posting keeps firstSeen and resets misses", () => {
  const first = mergeResults({ store: emptyStore(), results: [result([posting()])], config, now: NOW }).store;
  first.jobs[0].misses = 1;
  const { store, summary } = mergeResults({ store: first, results: [result([posting({ title: "Senior Backend Engineer II" })])], config, now: LATER });
  assert.equal(summary.new, 0);
  assert.equal(summary.seen, 1);
  assert.equal(store.jobs[0].firstSeen, NOW);
  assert.equal(store.jobs[0].lastSeen, LATER);
  assert.equal(store.jobs[0].misses, 0);
});

test("two consecutive misses archive the job; a third miss keeps it archived once", () => {
  let store = mergeResults({ store: emptyStore(), results: [result([posting()])], config, now: NOW }).store;
  const emptyButFetched = result([], { rawCount: 5 });
  store = mergeResults({ store, results: [emptyButFetched], config, now: LATER }).store;
  assert.equal(store.jobs[0].status, "active");
  assert.equal(store.jobs[0].misses, 1);
  const r = mergeResults({ store, results: [emptyButFetched], config, now: "2026-09-28T02:00:00.000Z" });
  assert.equal(r.store.jobs[0].status, "archived");
  assert.equal(r.store.jobs[0].closedAt, "2026-09-28T02:00:00.000Z");
  assert.equal(r.summary.archived, 1);
});

test("failed boards never increment misses", () => {
  let store = mergeResults({ store: emptyStore(), results: [result([posting()])], config, now: NOW }).store;
  store = mergeResults({ store, results: [{ ok: false, company: "Acme", companySlug: "acme", error: "timeout" }], config, now: LATER }).store;
  assert.equal(store.jobs[0].misses, 0);
  assert.equal(store.jobs[0].status, "active");
});

test("zero-result boards never increment misses", () => {
  let store = mergeResults({ store: emptyStore(), results: [result([posting()])], config, now: NOW }).store;
  store = mergeResults({ store, results: [result([], { rawCount: 0 })], config, now: LATER }).store;
  assert.equal(store.jobs[0].misses, 0);
});

test("a returning job is reopened with reopenedAt", () => {
  let store = mergeResults({ store: emptyStore(), results: [result([posting()])], config, now: NOW }).store;
  const emptyButFetched = result([], { rawCount: 5 });
  store = mergeResults({ store, results: [emptyButFetched], config, now: LATER }).store;
  store = mergeResults({ store, results: [emptyButFetched], config, now: "2026-09-28T02:00:00.000Z" }).store;
  assert.equal(store.jobs[0].status, "archived");
  const back = mergeResults({ store, results: [result([posting()])], config, now: "2026-09-29T02:00:00.000Z" });
  assert.equal(back.store.jobs[0].status, "active");
  assert.equal(back.store.jobs[0].reopenedAt, "2026-09-29T02:00:00.000Z");
  assert.equal(back.store.jobs[0].closedAt, null);
  assert.equal(back.summary.reopened, 1);
});

test("near-duplicates collapse to one record", () => {
  const twins = [posting({ jobId: "1", dedupeKey: "gh:acme:1" }), posting({ jobId: "2", dedupeKey: "gh:acme:2" })];
  const { store, summary } = mergeResults({ store: emptyStore(), results: [result(twins)], config, now: NOW });
  assert.equal(store.jobs.length, 1);
  assert.equal(summary.duplicates, 1);
});

test("degraded runs (archive=false) never archive", () => {
  let store = mergeResults({ store: emptyStore(), results: [result([posting()])], config, now: NOW }).store;
  const emptyButFetched = result([], { rawCount: 5 });
  store = mergeResults({ store, results: [emptyButFetched], config, now: LATER }).store;
  store = mergeResults({ store, results: [emptyButFetched], config, now: "2026-09-28T02:00:00.000Z", archive: false }).store;
  assert.equal(store.jobs[0].misses, 1);
  assert.equal(store.jobs[0].status, "active");
});

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

test("comp evidence appends once per url+band", () => {
  const paid = posting({ pay: { published: true, currency: "INR", baseMin: 5500000, baseMax: 7000000, totalOnly: false, raw: "₹55L–70L" } });
  const first = appendCompEvidence([], [paid], NOW);
  assert.equal(first.added, 1);
  assert.equal(first.evidence[0].baseMin, 5500000);
  const second = appendCompEvidence(first.evidence, [paid], LATER);
  assert.equal(second.added, 0);
  const changed = appendCompEvidence(first.evidence, [posting({ pay: { ...paid.pay, baseMax: 8000000 } })], LATER);
  assert.equal(changed.added, 1);
});

test("legacy records migrate to the new field shapes on merge", () => {
  const legacyStore = {
    updated: NOW,
    lastRun: null,
    jobs: [{
      ...posting(),
      pay: { published: true, currency: "INR", baseMinLpa: 55, baseMaxLpa: 70, totalOnly: false },
      location: { raw: "Remote - India", cities: [], mode: "remote", indiaScope: "remote_india" },
    }],
  };
  const { store } = mergeResults({ store: legacyStore, results: [], config, now: LATER, archive: false });
  assert.equal(store.jobs[0].pay.baseMin, 5500000);
  assert.equal(store.jobs[0].pay.baseMinLpa, undefined);
  assert.equal(store.jobs[0].location.scope, "remote_home");
  assert.equal(store.jobs[0].location.indiaScope, undefined);
});

test("legacy evidence migrates and still dedupes against new-shaped postings", () => {
  const legacyEvidence = [{ url: "https://jobs.example.com/1", currency: "INR", baseMinLpa: 55, baseMaxLpa: 70, totalOnly: false }];
  const paid = posting({ pay: { published: true, currency: "INR", baseMin: 5500000, baseMax: 7000000, totalOnly: false } });
  const res = appendCompEvidence(legacyEvidence, [paid], LATER);
  assert.equal(res.added, 0, "migrated evidence dedupes");
  assert.equal(res.evidence[0].baseMin, 5500000);
});

test("health tracks consecutive failures and resets on success", () => {
  let health = updateHealth({}, [{ ok: false, companySlug: "acme", error: "timeout" }], NOW);
  assert.equal(health.acme.consecutiveFails, 1);
  assert.equal(health.acme.lastError, "timeout");
  health = updateHealth(health, [{ ok: false, companySlug: "acme", error: "HTTP 500" }], LATER);
  assert.equal(health.acme.consecutiveFails, 2);
  health = updateHealth(health, [{ ok: true, companySlug: "acme" }], LATER);
  assert.equal(health.acme.consecutiveFails, 0);
  assert.equal(health.acme.lastError, null);
});

test("runSummaryLine matches the commit-message shape", () => {
  const line = runSummaryLine({ new: 12, archived: 5, seen: 400, boardsOk: 80 }, 86, "2026-09-26");
  assert.equal(line, "crawl: 2026-09-26 — +12 new, 5 archived, 400 seen, 80/86 boards ok");
});
