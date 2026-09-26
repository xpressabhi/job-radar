import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { listBoard, toPosting, fetchJobDetail } from "../scripts/sources/smartrecruiters.mjs";

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const company = { name: "Freshworks", slug: "Freshworks", ats: "sr" };

test("listBoard walks every page and stops at totalFound", async () => {
  // The checked-in payloads are trimmed for size, so synthesize honest full pages
  // (page size 100) from the real entries before testing pagination.
  const real1 = fixture("sr-page1.json");
  const real2 = fixture("sr-page2.json");
  const page1 = {
    ...real1,
    content: Array.from({ length: 100 }, (_, i) => ({ ...real1.content[i % real1.content.length], id: `1${i}` })),
  };
  const page2 = {
    ...real2,
    content: Array.from({ length: 25 }, (_, i) => ({ ...real2.content[i % real2.content.length], id: `2${i}` })),
  };
  const calls = [];
  const fetcher = {
    getJson: async (url) => {
      calls.push(url);
      if (url.includes("offset=100")) return { ok: true, status: 200, data: page2 };
      return { ok: true, status: 200, data: page1 };
    },
  };
  const res = await listBoard({ fetcher, company });
  assert.equal(res.ok, true);
  assert.equal(res.total, 125);
  assert.equal(res.postings.length, 125);
  assert.equal(calls.length, 2);
  assert.match(calls[0], /offset=0/);
  assert.match(calls[1], /offset=100/);
});

test("totalFound 0 is a valid empty tenant, not a failure", async () => {
  const fetcher = { getJson: async () => ({ ok: true, status: 200, data: { offset: 0, limit: 100, totalFound: 0, content: [] } }) };
  const res = await listBoard({ fetcher, company });
  assert.equal(res.ok, true);
  assert.equal(res.total, 0);
  assert.deepEqual(res.postings, []);
});

test("remote/hybrid flags map to mode; country is upper-cased; URL is the public posting", () => {
  const item = fixture("sr-page1.json").content[0];
  const p = toPosting(company, { ...item, location: { ...item.location, remote: true, hybrid: false } });
  assert.equal(p.mode, "remote");
  assert.equal(p.country, "US");
  assert.equal(p.url, `https://jobs.smartrecruiters.com/Freshworks/${item.id}`);
  const h = toPosting(company, { ...item, location: { ...item.location, remote: false, hybrid: true } });
  assert.equal(h.mode, "hybrid");
});

test("fetchJobDetail stitches sections into one description", async () => {
  const detail = {
    applyUrl: "https://jobs.smartrecruiters.com/Freshworks/123/apply",
    jobAd: { sections: { jobDescription: "<p>Build things</p>", qualifications: "<p>Ship them</p>" } },
  };
  const res = await fetchJobDetail({ fetcher: { getJson: async () => ({ ok: true, status: 200, data: detail }) }, company, jobId: "123" });
  assert.equal(res.ok, true);
  assert.match(res.description, /Build things/);
  assert.match(res.description, /Ship them/);
  assert.equal(res.applyUrl, detail.applyUrl);
});

test("404 is a clean failure", async () => {
  const res = await listBoard({ fetcher: { getJson: async () => ({ ok: false, status: 404, error: "HTTP 404" }) }, company });
  assert.equal(res.ok, false);
  assert.equal(res.status, 404);
});
