import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { listBoard, toPosting } from "../scripts/sources/ashby.mjs";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/ashby-list.json", import.meta.url), "utf8"));
const company = { name: "Cohere", slug: "cohere", ats: "ashby" };
const fakeFetcher = (result) => ({ getJson: async () => result });

test("listBoard normalizes a real trimmed payload", async () => {
  const res = await listBoard({ fetcher: fakeFetcher({ ok: true, status: 200, data: fixture }), company });
  assert.equal(res.ok, true);
  assert.equal(res.postings.length, fixture.jobs.length);
  const p = res.postings[0];
  assert.equal(p.source, "ashby");
  assert.equal(p.company, "Cohere");
  assert.match(p.postedAt, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(p.locations.length >= 1);
  assert.ok(p.compensation?.compensationTierSummary);
});

test("isListed=false postings are excluded", async () => {
  const data = { ...fixture, jobs: [{ ...fixture.jobs[0], id: "hidden", isListed: false }, ...fixture.jobs] };
  const res = await listBoard({ fetcher: fakeFetcher({ ok: true, status: 200, data }), company });
  assert.equal(res.postings.some((p) => p.jobId === "hidden"), false);
  assert.equal(res.postings.length, fixture.jobs.length);
});

test("secondaryLocations objects become plain location strings", () => {
  const job = fixture.jobs.find((j) => j.secondaryLocations?.length);
  const p = toPosting(company, job);
  for (const loc of p.locations) assert.equal(typeof loc, "string");
  assert.ok(p.locations.length > 1);
});

test("isRemote null / missing workplaceType does not crash and leaves mode null", () => {
  const p = toPosting(company, { ...fixture.jobs[0], isRemote: null, workplaceType: undefined });
  assert.equal(p.mode, null);
});

test("unexpected payload shape is reported, not thrown", async () => {
  const res = await listBoard({ fetcher: fakeFetcher({ ok: true, status: 200, data: { jobs: "nope" } }), company });
  assert.equal(res.ok, false);
  assert.match(res.error, /payload shape/);
});
