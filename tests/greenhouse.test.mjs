import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { listBoard, fetchJobDetail, stripHtml } from "../scripts/sources/greenhouse.mjs";

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const company = { name: "Groww", slug: "groww", ats: "gh" };
const fakeFetcher = (result) => ({ getJson: async () => result });

test("listBoard normalizes a real trimmed payload", async () => {
  const data = fixture("greenhouse-list.json");
  const res = await listBoard({ fetcher: fakeFetcher({ ok: true, status: 200, data }), company });
  assert.equal(res.ok, true);
  assert.equal(res.total, data.meta.total);
  assert.equal(res.postings.length, data.jobs.length);
  const p = res.postings[0];
  assert.equal(p.source, "gh");
  assert.equal(p.company, "Groww");
  assert.equal(p.companySlug, "groww");
  assert.equal(p.jobId, String(data.jobs[0].id));
  assert.ok(p.title.length > 0);
  assert.ok(p.url.startsWith("https://"));
  assert.equal(p.description, null);
  assert.equal(p.postedAt, null);
});

test("unknown slug returns a clean 404 failure, never a throw", async () => {
  const res = await listBoard({ fetcher: fakeFetcher({ ok: false, status: 404, error: "HTTP 404" }), company });
  assert.equal(res.ok, false);
  assert.equal(res.status, 404);
});

test("unexpected payload shape is reported, not thrown", async () => {
  const res = await listBoard({ fetcher: fakeFetcher({ ok: true, status: 200, data: { nope: true } }), company });
  assert.equal(res.ok, false);
  assert.match(res.error, /payload shape/);
});

test("fetchJobDetail returns description, postedAt, and null pay ranges when empty", async () => {
  const data = fixture("greenhouse-detail.json");
  const res = await fetchJobDetail({
    fetcher: fakeFetcher({ ok: true, status: 200, data }),
    company,
    jobId: String(data.id),
  });
  assert.equal(res.ok, true);
  assert.ok(res.description.length > 0);
  assert.ok(!res.description.includes("<"));
  assert.match(res.postedAt, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(res.payInputRanges, null);
});

test("stripHtml collapses whitespace and decodes entities", () => {
  assert.equal(stripHtml("<p>Hello&nbsp;<b>World</b> &amp; co</p>"), "Hello World & co");
});

test("stripHtml handles Greenhouse's escaped HTML (regression)", () => {
  assert.equal(stripHtml("&lt;div&gt;&lt;strong&gt;About&lt;/strong&gt;&lt;/div&gt;"), "About");
});
