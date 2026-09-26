import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  isEngineeringTitle,
  classifySeniority,
  classifyGeography,
  classifyPay,
  applyFilters,
} from "../scripts/lib/filters.mjs";
import { loadConfigFile } from "../scripts/lib/config.mjs";

const config = loadConfigFile(new URL("./fixtures/config.json", import.meta.url));
const ghPay = JSON.parse(readFileSync(new URL("./fixtures/gh-pay-detail.json", import.meta.url), "utf8"));
const leverZero = JSON.parse(readFileSync(new URL("./fixtures/lever-zero-salary.json", import.meta.url), "utf8"));

const company = (tier = "saas", vetted = 60) => ({
  name: "Example",
  slug: "example",
  ats: "gh",
  tier,
  payVetting: { seniorBaseMinLpa: vetted },
});

const posting = (overrides = {}) => ({
  source: "gh",
  company: "Example",
  companySlug: "example",
  jobId: "1",
  title: "Senior Backend Engineer",
  locationRaw: "Bengaluru, India",
  locations: ["Bengaluru, India"],
  country: null,
  mode: null,
  url: "https://jobs.example.com/1?utm_source=x",
  postedAt: "2026-09-20",
  description: null,
  ...overrides,
});

// ---------- Engineering gate ----------

test("engineering gate drops non-engineering roles", () => {
  for (const title of ["Account Executive", "Senior Product Manager", "Sales Engineer", "Technical Recruiter", "Senior Product Designer", "Customer Success Manager", "Sr. AI GTM Engineer"]) {
    assert.equal(isEngineeringTitle(title), false, title);
  }
});

test("engineering gate keeps engineers and engineering leadership", () => {
  for (const title of ["Design Engineer", "Senior Engineering Manager", "Site Reliability Engineer", "Staff Data Scientist", "Forward Deployed Engineer"]) {
    assert.equal(isEngineeringTitle(title), true, title);
  }
});

// ---------- Seniority ----------

test("senior+ tokens are recognized with the right label", () => {
  const cases = [
    ["Senior Software Engineer", "senior"],
    ["Sr. Backend Engineer", "senior"],
    ["Staff Software Engineer, Backend", "staff"],
    ["Principal Engineer", "principal"],
    ["Tech Lead, Platform", "lead"],
    ["Software Architect", "architect"],
    ["Director of Engineering", "director"],
    ["Head of Engineering", "head"],
    ["Engineering Manager", "em"],
    ["VP Engineering", "vp"],
    ["Senior SDE", "senior"],
  ];
  for (const [title, label] of cases) {
    const r = classifySeniority(title, "saas", config);
    assert.equal(r.keep, true, title);
    assert.equal(r.seniority, label, title);
    assert.equal(r.levelSource, "title");
  }
});

test("seniority rules are config-overridable (keywords and tiers)", () => {
  const custom = loadConfigFile(new URL("./fixtures/config.json", import.meta.url));
  custom.roles = {
    seniority: {
      ...custom.roles.seniority,
      includeKeywords: ["founding engineer"],
      excludeKeywords: ["forward deployed"],
      assumeSeniorForTiers: [],
    },
  };
  assert.equal(classifySeniority("Founding Engineer", "saas", custom).keep, true);
  assert.equal(classifySeniority("Forward Deployed Engineer", "frontier-ai", custom).keep, false, "custom exclusion wins");
  assert.equal(classifySeniority("Software Engineer", "frontier-ai", custom).keep, false, "tier assumption overridden to none");
  assert.equal(classifySeniority("Member of Technical Staff", "frontier-ai", custom).keep, false, "MTS still skips keywords to the tier rule");
});

test("junior/mid markers are excluded even when a senior token is present", () => {
  for (const title of ["Senior Engineer II", "Associate Staff Engineer", "Junior Backend Engineer", "New Grad Software Engineer", "Engineering Intern", "Graduate Developer", "Software Engineer (Entry Level)", "SDE 2"]) {
    assert.equal(classifySeniority(title, "frontier-ai", config).keep, false, title);
  }
});

test("unlabeled titles pass only at assumed-senior tiers, flagged tier-assumed", () => {
  for (const title of ["Member of Technical Staff", "Forward Deployed Engineer", "Software Engineer"]) {
    const frontier = classifySeniority(title, "frontier-ai", config);
    assert.equal(frontier.keep, true, title);
    assert.equal(frontier.levelSource, "tier-assumed", title);
    assert.equal(classifySeniority(title, "saas", config).keep, false, title);
    assert.equal(classifySeniority(title, "india-product", config).keep, false, title);
  }
});

// ---------- Geography ----------

test("home-country postings are kept and cities extracted", () => {
  const r = classifyGeography(posting(), config);
  assert.equal(r.keep, true);
  assert.equal(r.scope, "located");
  assert.deepEqual(r.cities, ["Bengaluru"]);
});

test("remote home-country postings keep scope remote_home; lowercase Lever text works", () => {
  const r = classifyGeography(posting({ locations: ["bengaluru"], locationRaw: "bengaluru", country: "IN", mode: "remote" }), config);
  assert.equal(r.keep, true);
  assert.equal(r.scope, "remote_home");
  assert.deepEqual(r.cities, ["Bengaluru"]);
});

test("remote with no restriction is kept as remote_global", () => {
  for (const loc of ["Remote, Global", "Remote - APAC", "Remote"]) {
    const r = classifyGeography(posting({ locationRaw: loc, locations: [loc], mode: "remote" }), config);
    assert.equal(r.keep, true, loc);
    assert.equal(r.scope, "remote_global", loc);
  }
});

test("other-geography restrictions are dropped", () => {
  const cases = [
    { locationRaw: "Remote - US", locations: ["Remote - US"], mode: "remote" },
    { locationRaw: "New York City, NY", locations: ["New York City, NY"] },
    { locationRaw: "Paris, France", locations: ["Paris, France"], country: "France" },
    { locationRaw: "Singapore", locations: ["Singapore"], mode: "remote" },
    { locationRaw: "Toronto, Canada", locations: ["Toronto, Canada"], mode: "remote" },
    { locationRaw: "Remote", locations: ["Remote"], country: "US", mode: "remote" },
    { locationRaw: "Remote (EMEA)", locations: ["Remote (EMEA)"], mode: "remote" },
  ];
  for (const c of cases) {
    assert.equal(classifyGeography(posting(c), config).keep, false, JSON.stringify(c));
  }
});

test("no location signal at all is dropped", () => {
  assert.equal(classifyGeography(posting({ locationRaw: "", locations: [] }), config).keep, false);
});

// ---------- Pay ----------

test("published INR base band at/above floor is kept", () => {
  const r = classifyPay({ posting: posting({ salaryRange: { min: 5500000, max: 7000000, currency: "INR", interval: "per-year-salary" } }), company: company(), config });
  assert.equal(r.keep, true);
  assert.equal(r.pay.published, true);
  assert.equal(r.pay.baseMin, 5500000);
  assert.equal(r.pay.baseMax, 7000000);
  assert.equal(r.pay.totalOnly, false);
});

test("published base band below floor is dropped on the lower bound", () => {
  const r = classifyPay({ posting: posting({ salaryRange: { min: 4000000, max: 6000000, currency: "INR", interval: "per-year-salary" } }), company: company(), config });
  assert.equal(r.keep, false);
  assert.match(r.reason, /below floor/);
});

test("zero-value Lever ranges count as unpublished (real fixture)", () => {
  const r = classifyPay({ posting: posting({ salaryRange: leverZero.salaryRange }), company: company("saas", 60), config });
  assert.equal(r.keep, true);
  assert.equal(r.pay.published, false);
  assert.equal(r.pay.vettedMin, 6000000);
});

test("Ashby typed salary components convert from CAD", () => {
  const compensation = {
    compensationTierSummary: "CA$215K – CA$310K • Offers Equity",
    summaryComponents: [
      { compensationType: "EquityPercentage", interval: "NONE", currencyCode: null, minValue: null, maxValue: null },
      { compensationType: "Salary", interval: "1 YEAR", currencyCode: "CAD", minValue: 215000, maxValue: 310000 },
    ],
  };
  const r = classifyPay({ posting: posting({ compensation }), company: company(), config });
  assert.equal(r.keep, true);
  assert.equal(r.pay.baseMin, 13760000);
  assert.equal(r.pay.baseMax, 19840000);
  assert.equal(r.pay.totalOnly, false);
});

test("Ashby total-only summary above floor is kept and flagged base unverified", () => {
  const compensation = {
    compensationTierSummary: "CA$215K – CA$310K • Offers Equity",
    summaryComponents: [{ compensationType: "EquityPercentage", interval: "NONE" }],
  };
  const r = classifyPay({ posting: posting({ compensation }), company: company(), config });
  assert.equal(r.keep, true);
  assert.equal(r.pay.published, true);
  assert.equal(r.pay.totalOnly, true);
});

test("Ashby total-only summary below floor is dropped", () => {
  const compensation = {
    compensationTierSummary: "CA$30K – CA$40K",
    summaryComponents: [{ compensationType: "EquityPercentage", interval: "NONE" }],
  };
  const r = classifyPay({ posting: posting({ compensation }), company: company(), config });
  assert.equal(r.keep, false);
  assert.match(r.reason, /total comp 1920000/);
});

test("Greenhouse pay transparency cents convert to base currency (real fixture)", () => {
  const r = classifyPay({ posting: posting({ payInputRanges: ghPay.pay_input_ranges }), company: company(), config });
  assert.equal(r.keep, true);
  assert.equal(r.pay.baseMin, 16440000);
  assert.equal(r.pay.baseMax, 23020000);
  assert.equal(r.pay.totalOnly, false);
});

test("Greenhouse pay transparency below floor is dropped", () => {
  const ranges = [{ min_cents: 5000000, max_cents: 6000000, currency_type: "USD", title: "The base salary range for this position is:" }];
  const r = classifyPay({ posting: posting({ payInputRanges: ranges }), company: company(), config });
  assert.equal(r.keep, false);
});

test("unsupported currency keeps the role on company vetting, with a flag", () => {
  const r = classifyPay({
    posting: posting({ salaryRange: { min: 200000, max: 250000, currency: "BRL", interval: "per-year-salary" } }),
    company: company("saas", 60),
    config,
  });
  assert.equal(r.keep, true);
  assert.equal(r.pay.published, false);
  assert.deepEqual(r.pay.unsupportedCurrency, ["BRL"]);
});

test("no published pay keeps the role on company vetting", () => {
  const r = classifyPay({ posting: posting(), company: company("india-product", 55), config });
  assert.equal(r.keep, true);
  assert.deepEqual(r.pay, { published: false, vettedMin: 5500000 });
});

test("pay.enabled: false switches the floor gate off but still records bands", () => {
  const off = loadConfigFile(new URL("./fixtures/config.json", import.meta.url));
  off.pay = { ...off.pay, enabled: false };
  const ranges = [{ min_cents: 10000000, max_cents: 20000000, currency_type: "INR", title: "base" }];
  const r = classifyPay({ posting: posting({ payInputRanges: ranges }), company: company(), config: off });
  assert.equal(r.keep, true);
  assert.equal(r.pay.published, true);
  assert.equal(r.pay.baseMin, 100000);
  assert.equal(r.pay.baseMax, 200000);
});

// ---------- Pipeline ----------

test("applyFilters composes title, geography, and pay into an enriched posting", () => {
  const res = applyFilters({ posting: posting(), company: company(), config });
  assert.equal(res.keep, true);
  assert.equal(res.posting.title, "Senior Backend Engineer");
  assert.equal(res.posting.url, "https://jobs.example.com/1");
  assert.equal(res.posting.dedupeKey, "gh:example:1");
  assert.equal(res.posting.seniority, "senior");
  assert.equal(res.posting.levelSource, "title");
  assert.deepEqual(res.posting.location, { raw: "Bengaluru, India", cities: ["Bengaluru"], mode: null, scope: "located" });
  assert.equal(res.posting.pay.vettedMin, 6000000);
});

test("applyFilters drops non-engineering and junior roles before any parsing", () => {
  assert.equal(applyFilters({ posting: posting({ title: "Account Executive" }), company: company(), config }).keep, false);
  assert.equal(applyFilters({ posting: posting({ title: "Senior Engineer II" }), company: company(), config }).keep, false);
});
