import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { listBoard, toPosting } from "../scripts/sources/workable.mjs";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/workable-list.json", import.meta.url), "utf8"));
const company = { name: "Hugging Face", slug: "huggingface", ats: "workable" };
const fakeFetcher = (result) => ({ getJson: async () => result });

test("listBoard normalizes a real trimmed payload", async () => {
  const res = await listBoard({ fetcher: fakeFetcher({ ok: true, status: 200, data: fixture }), company });
  assert.equal(res.ok, true);
  assert.equal(res.postings.length, fixture.jobs.length);
  const p = res.postings[0];
  assert.equal(p.source, "workable");
  assert.equal(p.company, "Hugging Face");
  assert.match(p.postedAt, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(p.url.startsWith("https://"));
});

test("telecommuting maps to mode remote; false stays null", () => {
  assert.equal(toPosting(company, { ...fixture.jobs[0], telecommuting: true }).mode, "remote");
  assert.equal(toPosting(company, { ...fixture.jobs[0], telecommuting: false }).mode, null);
});

test("structured locations become readable strings", () => {
  const p = toPosting(company, fixture.jobs[0]);
  for (const loc of p.locations) assert.equal(typeof loc, "string");
  assert.ok(p.locations.length >= 1);
});

test("description is stripped of HTML", () => {
  const p = toPosting(company, { ...fixture.jobs[0], description: "<p>Hello <b>World</b></p>" });
  assert.equal(p.description, "Hello World");
});

test("missing board returns a clean 404", async () => {
  const res = await listBoard({ fetcher: fakeFetcher({ ok: false, status: 404, error: "HTTP 404" }), company });
  assert.equal(res.ok, false);
  assert.equal(res.status, 404);
});

test("unexpected payload shape is reported, not thrown", async () => {
  const res = await listBoard({ fetcher: fakeFetcher({ ok: true, status: 200, data: { jobs: "nope" } }), company });
  assert.equal(res.ok, false);
  assert.match(res.error, /payload shape/);
});
