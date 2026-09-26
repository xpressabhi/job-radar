import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { listBoard, toPosting } from "../scripts/sources/lever.mjs";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/lever-list.json", import.meta.url), "utf8"));
const company = { name: "Meesho", slug: "meesho", ats: "lever" };
const fakeFetcher = (result) => ({ getJson: async () => result });

test("listBoard normalizes a real trimmed payload", async () => {
  const res = await listBoard({ fetcher: fakeFetcher({ ok: true, status: 200, data: fixture }), company });
  assert.equal(res.ok, true);
  assert.equal(res.postings.length, fixture.length);
  const p = res.postings[0];
  assert.equal(p.source, "lever");
  assert.equal(p.company, "Meesho");
  assert.match(p.postedAt, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(["onsite", "hybrid", "remote"].includes(p.mode));
  assert.ok(p.description.length > 0);
  assert.ok(p.country);
});

test("multi-location postings keep every location, primary first", () => {
  const job = fixture.find((j) => j.categories.allLocations.length > 1);
  const p = toPosting(company, job);
  assert.deepEqual(p.locations, job.categories.allLocations);
  assert.equal(p.locationRaw, job.categories.allLocations[0]);
});

test("workplaceType maps to mode; unknown values stay null", () => {
  assert.equal(toPosting(company, { ...fixture[0], workplaceType: "remote" }).mode, "remote");
  assert.equal(toPosting(company, { ...fixture[0], workplaceType: "something-else" }).mode, null);
});

test("missing slug returns a clean 404", async () => {
  const res = await listBoard({ fetcher: fakeFetcher({ ok: false, status: 404, error: "HTTP 404" }), company });
  assert.equal(res.ok, false);
  assert.equal(res.status, 404);
});

test("non-array payload is reported, not thrown", async () => {
  const res = await listBoard({ fetcher: fakeFetcher({ ok: true, status: 200, data: { nope: true } }), company });
  assert.equal(res.ok, false);
  assert.match(res.error, /payload shape/);
});
