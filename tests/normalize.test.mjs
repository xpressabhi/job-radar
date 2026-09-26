import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanTitle, canonicalUrl, dedupeKey, nearDupeKey } from "../scripts/lib/normalize.mjs";

test("cleanTitle strips mode markers, req ids, emoji, and whitespace noise", () => {
  assert.equal(cleanTitle("Senior Software Engineer (Remote) [Req #12345]"), "Senior Software Engineer");
  assert.equal(cleanTitle("Backend Engineer - Bengaluru"), "Backend Engineer");
  assert.equal(cleanTitle("Staff Engineer 🚀  -  Platform"), "Staff Engineer - Platform");
  assert.equal(cleanTitle("Lead Engineer | Remote"), "Lead Engineer");
  assert.equal(cleanTitle("  Site Reliability Engineer  (Hybrid)  "), "Site Reliability Engineer");
});

test("cleanTitle keeps meaningful segments", () => {
  assert.equal(cleanTitle("Senior Engineer, Payments"), "Senior Engineer, Payments");
  assert.equal(cleanTitle("Senior Software Engineer, Backend"), "Senior Software Engineer, Backend");
});

test("canonicalUrl drops tracking params, hash, and trailing slash", () => {
  const clean = canonicalUrl("https://jobs.example.com/role/123/?utm_source=x&gh_src=abc&gh_jid=9#apply");
  assert.equal(clean, "https://jobs.example.com/role/123?gh_jid=9");
});

test("canonicalUrl leaves non-URLs alone and tolerates junk", () => {
  assert.equal(canonicalUrl(""), "");
  assert.equal(canonicalUrl("not a url"), "not a url");
});

test("dedupeKey is ats:company:jobId", () => {
  assert.equal(dedupeKey({ source: "gh", companySlug: "anthropic", jobId: "42" }), "gh:anthropic:42");
});

test("nearDupeKey ignores case and mode noise", () => {
  const a = nearDupeKey({ companySlug: "stripe", title: "Senior Software Engineer (Remote)", location: { cities: ["Bengaluru"] } });
  const b = nearDupeKey({ companySlug: "stripe", title: "senior software engineer", location: { cities: ["bengaluru"] } });
  assert.equal(a, b);
});
