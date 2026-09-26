import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyStore, mergeResults, appendCompEvidence, updateHealth, runSummaryLine } from "../scripts/lib/store.mjs";

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
