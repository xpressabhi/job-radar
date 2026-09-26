import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderSite, payLabel, locationLabel, formatDay } from "../scripts/render.mjs";
import { emptyStore } from "../scripts/lib/store.mjs";

const store = JSON.parse(readFileSync(new URL("./fixtures/store-sample.json", import.meta.url), "utf8"));
const files = renderSite({ store, config: {}, now: "2026-09-26T02:00:00.000Z" });

test("index renders server-side rows with filter hooks and real data", () => {
  const html = files["index.html"];
  assert.match(html, /Applied AI Architect/);
  assert.match(html, /Staff Backend Engineer/);
  assert.match(html, /id="filters"/);
  assert.match(html, /id="f-category"/);
  assert.match(html, /data-category="ai-ml"/);
  assert.match(html, /₹55–70L base/);
  assert.match(html, /vetted ≥₹65L base/);
  assert.match(html, /84\/86/);
  assert.match(html, /data-preset="backend"/);
});

test("index escapes untrusted content", () => {
  assert.match(files["index.html"], /Anthropic &amp; Co &lt;script&gt;/);
  assert.ok(!files["index.html"].includes("<script>alert"));
});

test("archive groups closed roles by month", () => {
  const html = files["archive.html"];
  assert.match(html, /August 2026/);
  assert.match(html, /Senior Frontend Engineer/);
  assert.match(html, /closed 15 Aug 2026/);
});

test("jobs.json and feed.xml are valid and complete", () => {
  const feed = files["feed.xml"];
  assert.match(feed, /<rss version="2.0">/);
  assert.match(feed, /<item>/);
  assert.match(feed, /Applied AI Architect — Anthropic &amp; Co &lt;script&gt;/);
  const jobs = JSON.parse(files["jobs.json"]);
  assert.equal(jobs.jobs.length, 3);
});

test("empty store renders gracefully", () => {
  const empty = renderSite({ store: emptyStore(), config: {}, now: "2026-09-26T02:00:00.000Z" });
  assert.match(empty["index.html"], /No live roles right now/);
  assert.match(empty["archive.html"], /Nothing archived yet/);
});

test("labels are honest about published vs vetted pay", () => {
  assert.equal(payLabel({ published: true, baseMinLpa: 55, baseMaxLpa: 70, totalOnly: false }), "₹55–70L base");
  assert.equal(payLabel({ published: true, baseMinLpa: 60, baseMaxLpa: 60, totalOnly: true }), "₹60L total comp · base unverified");
  assert.equal(payLabel({ published: false, vettedSeniorMinLpa: 70 }), "vetted ≥₹70L base");
  assert.equal(payLabel({}), "");
});

test("location labels cover the three India scopes", () => {
  assert.equal(locationLabel({ location: { cities: ["Bengaluru", "Mumbai"] } }), "Bengaluru, Mumbai");
  assert.equal(locationLabel({ location: { cities: [], indiaScope: "remote_india" } }), "Remote (India)");
  assert.equal(locationLabel({ location: { cities: [], indiaScope: "remote_global" } }), "Remote (global)");
});

test("formatDay is deterministic and null-safe", () => {
  assert.equal(formatDay("2026-09-20"), "20 Sep 2026");
  assert.equal(formatDay(null), "");
  assert.equal(formatDay("nonsense"), "");
});
