import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderSite, payLabel, locationLabel, formatDay } from "../scripts/render.mjs";
import { emptyStore } from "../scripts/lib/store.mjs";

const store = JSON.parse(readFileSync(new URL("./fixtures/store-sample.json", import.meta.url), "utf8"));
// The fixture intentionally keeps legacy pay/scope fields: these tests exercise the tolerant readers.
const config = {
  pay: { floorAnnual: 5000000, display: { symbol: "₹", divisor: 100000, suffix: "L", decimals: 1 } },
};
const files = renderSite({ store, config, now: "2026-09-26T02:00:00.000Z" });

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
  assert.match(html, /below the ₹50L base floor/);
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

test("active jobs are ordered by employer posting date, falling back to first seen", () => {
  const staleFirstSeenFresh = {
    ...store.jobs[0],
    id: "x:fresh-post",
    title: "Fresh Post Engineer",
    postedAt: "2026-09-25",
    firstSeen: "2026-09-01T02:00:00.000Z",
  };
  const oldPostRecentSeen = {
    ...store.jobs[0],
    id: "x:old-post",
    title: "Old Post Engineer",
    postedAt: "2026-09-10",
    firstSeen: "2026-09-20T02:00:00.000Z",
  };
  const noPosted = {
    ...store.jobs[0],
    id: "x:no-post",
    title: "No Posted Date Engineer",
    postedAt: null,
    firstSeen: "2026-09-22T02:00:00.000Z",
  };
  const html = renderSite({
    store: { jobs: [oldPostRecentSeen, noPosted, staleFirstSeenFresh] },
    config,
    now: "2026-09-26T02:00:00.000Z",
  })["index.html"];
  const order = [...html.matchAll(/<h3><a[^>]*>([^<]+)</g)].map((m) => m[1]);
  assert.deepEqual(order, ["Fresh Post Engineer", "No Posted Date Engineer", "Old Post Engineer"]);
  assert.match(html, /data-fresh="2026-09-25"/);
});

test("empty store renders gracefully", () => {
  const empty = renderSite({ store: emptyStore(), config, now: "2026-09-26T02:00:00.000Z" });
  assert.match(empty["index.html"], /No live roles right now/);
  assert.match(empty["archive.html"], /Nothing archived yet/);
});

test("labels are honest about published vs vetted pay", () => {
  assert.equal(payLabel({ published: true, baseMin: 5500000, baseMax: 7000000, totalOnly: false }, config.pay), "₹55–70L base");
  assert.equal(payLabel({ published: true, baseMin: 6000000, baseMax: 6000000, totalOnly: true }, config.pay), "₹60L total comp · base unverified");
  assert.equal(payLabel({ published: false, vettedMin: 7000000 }, config.pay), "vetted ≥₹70L base");
  // legacy INR-lakhs shapes still render through the tolerant readers
  assert.equal(payLabel({ published: true, baseMinLpa: 55, baseMaxLpa: 70, totalOnly: false }, config.pay), "₹55–70L base");
  assert.equal(payLabel({ published: false, vettedSeniorMinLpa: 70 }, config.pay), "vetted ≥₹70L base");
  assert.equal(payLabel({}, config.pay), "");
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

test("branding comes from config; a fork renders no upstream owner URLs", () => {
  const fork = renderSite({ store: emptyStore(), config: { site: { name: "Discovery Radar" } }, now: "2026-09-26T02:00:00.000Z" });
  assert.match(fork["index.html"], /Discovery Radar/);
  assert.match(fork["archive.html"], /Discovery Radar/);
  assert.ok(!fork["index.html"].includes("xpressabhi"), "index has no upstream URL");
  assert.ok(!fork["archive.html"].includes("xpressabhi"), "archive has no upstream URL");
  assert.ok(!fork["feed.xml"].includes("xpressabhi"), "feed has no upstream URL");
  assert.ok(!fork["feed.xml"].includes("<link>"), "no siteUrl → no channel link");
  assert.match(fork["index.html"], /Built with no runtime dependencies/, "no repo → generic source note");
});

test("siteUrl and repo flow into RSS and source links when resolved", () => {
  const forked = renderSite({
    store,
    config,
    siteUrl: "https://alice.github.io/my-jobs/",
    repo: "alice/my-jobs",
    now: "2026-09-26T02:00:00.000Z",
  });
  assert.match(forked["feed.xml"], /<link>https:\/\/alice\.github\.io\/my-jobs\/<\/link>/);
  assert.match(forked["index.html"], /github\.com\/alice\/my-jobs/);
  assert.match(forked["archive.html"], /github\.com\/alice\/my-jobs/);
});

test("about bullets: generated from config by default, overridable via site.about", () => {
  const generated = renderSite({
    store: emptyStore(),
    config: {
      location: { country: "Germany" },
      pay: { floorAnnual: 90000, companyFloorAnnual: 60000, currency: "EUR", display: { symbol: "€", divisor: 1, suffix: "", decimals: 0 } },
    },
    now: "2026-09-26T02:00:00.000Z",
  })["index.html"];
  assert.match(generated, /remote-Germany/);
  assert.match(generated, /€90,000 base at senior level in Germany/);

  const overridden = renderSite({
    store: emptyStore(),
    config: { ...config, site: { about: ["<strong>Custom:</strong> copy"] } },
    now: "2026-09-26T02:00:00.000Z",
  })["index.html"];
  assert.match(overridden, /<strong>Custom:<\/strong> copy/);
});
