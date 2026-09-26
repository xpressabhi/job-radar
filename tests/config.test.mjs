import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEFAULTS,
  loadConfig,
  validateConfig,
  deepMerge,
  compilePatterns,
  compileKeywords,
  keywordPattern,
  deriveUserAgent,
} from "../scripts/lib/config.mjs";

const repoRaw = JSON.parse(readFileSync(new URL("../data/config.json", import.meta.url), "utf8"));

test("bare defaults are inert and generic", () => {
  const cfg = loadConfig({});
  assert.equal(cfg.location.country, null);
  assert.equal(cfg.pay.currency, "USD");
  assert.equal(cfg.pay.floorAnnual, 0);
  assert.equal(cfg.pay.vettingRequired, false);
  assert.deepEqual(cfg.location.cities, {});
  assert.deepEqual(cfg.pay.fxRates, {});
  assert.ok(cfg.location.excludeRegex, "world exclusion regex ships as a default");
  assert.ok(cfg.roles.seniority.includePatterns.length > 0, "seniority patterns ship as defaults");

  const { errors } = validateConfig(cfg);
  assert.match(errors.join("\n"), /location\.country/);
});

test("deep merge: objects merge, arrays replace, scalars win, defaults untouched", () => {
  const cfg = loadConfig({
    pay: { display: { suffix: "L" }, fxRates: { INR: 1 } },
    location: { countryCode: "in" },
    roles: { seniority: { includeKeywords: ["member of technical staff"] } },
  });
  assert.equal(cfg.pay.currency, "USD"); // untouched default
  assert.equal(cfg.pay.display.suffix, "L"); // merged in
  assert.equal(cfg.pay.display.symbol, "$"); // sibling default kept
  assert.deepEqual(cfg.pay.fxRates, { INR: 1 }); // object replaces defaults object when merged over {}
  assert.deepEqual(cfg.roles.seniority.includeKeywords, ["member of technical staff"]); // array replaced
  assert.equal(cfg.roles.seniority.excludePatterns.length, DEFAULTS.roles.seniority.excludePatterns.length);

  // defaults are never mutated
  assert.equal(DEFAULTS.pay.display.suffix, "");
  assert.deepEqual(DEFAULTS.pay.fxRates, {});
  assert.equal(loadConfig({ location: { countryCode: "US" } }).location.countryCode, "US");
  assert.equal(DEFAULTS.location.countryCode, null);

  // deepMerge is pure
  const base = { a: { b: 1 }, list: [1] };
  const merged = deepMerge(base, { a: { c: 2 }, list: [2, 3] });
  assert.deepEqual(merged, { a: { b: 1, c: 2 }, list: [2, 3] });
  assert.deepEqual(base, { a: { b: 1 }, list: [1] });
});

test("keyword and pattern compilation", () => {
  assert.ok(keywordPattern("C++").re.test("Senior C++ Engineer"));
  assert.ok(keywordPattern("site reliability").re.test("Site Reliability Engineer"));
  assert.ok(!keywordPattern("a.b").re.test("axb"), "regex characters are escaped");
  assert.equal(keywordPattern("Staff").label, "Staff");

  const [entry] = compilePatterns([{ label: "em", pattern: "\\bengineering manager\\b" }]);
  assert.ok(entry.re.test("Engineering Manager, Platform"));
  assert.equal(entry.label, "em");
  assert.deepEqual(compileKeywords(["Staff", "Lead"]).map((k) => k.label), ["Staff", "Lead"]);
});

test("home country code is dropped from exclusion lists", () => {
  const cfg = loadConfig({ location: { country: "India", countryCode: "IN" } });
  assert.ok(!cfg.location.excludeCountryCodes.includes("IN"));
  assert.ok(cfg.location.excludeCountryCodes.includes("US"));
  assert.ok(DEFAULTS.location.excludeCountryCodes.includes("IN"), "defaults untouched");
});

test("validator reports the home country mentioned in the exclusion regex as a warning", () => {
  const { errors, warnings } = validateConfig(
    loadConfig({ location: { country: "India", countryCode: "IN", excludeRegex: "\\bindia\\b" } }),
  );
  assert.equal(errors.length, 0, errors.join("\n"));
  assert.match(warnings.join("\n"), /mentions the home country/);
});

test("the migrated repo config keeps its behavior through legacy aliases", () => {
  const cfg = loadConfig(repoRaw, { env: {} });
  assert.equal(cfg.location.country, "India");
  assert.equal(cfg.pay.currency, "INR");
  assert.equal(cfg.pay.floorAnnual, 5000000);
  assert.equal(cfg.pay.companyFloorAnnual, 2000000);
  assert.equal(cfg.pay.vettingRequired, true);
  assert.equal(cfg.payFloorBaseLpa, 50);
  assert.equal(cfg.companyPayFloorBaseLpa, 20);
  assert.equal(cfg.fxToInr.USD, 87);
  assert.equal(cfg.archiveMisses, 2);
  assert.equal(cfg.requestDelayMs, 1000);
  assert.equal(cfg.timeoutMs, 20000);
  assert.equal(cfg.retries, 1);
  assert.equal(cfg.llm.maxPerRun, 40);
  assert.equal(cfg.location.cities.bangalore, "Bengaluru");

  const { errors, warnings } = validateConfig(cfg);
  assert.equal(errors.length, 0, errors.join("\n"));
  assert.equal(warnings.length, 0, warnings.join("\n"));
});

test("legacy aliases stay out of JSON output", () => {
  const cfg = loadConfig(repoRaw, { env: {} });
  const roundTripped = JSON.parse(JSON.stringify(cfg));
  assert.equal(roundTripped.payFloorBaseLpa, undefined);
  assert.equal(roundTripped.userAgent, undefined);
  assert.equal(roundTripped.pay.floorAnnual, 5000000);
});

test("user agent derives per fork and honors an explicit override", () => {
  assert.equal(deriveUserAgent({}), "job-radar/1.0");
  assert.equal(deriveUserAgent({ GITHUB_REPOSITORY: "someone/my-jobs" }), "job-radar/1.0 (+https://github.com/someone/my-jobs)");
  assert.equal(loadConfig({}, { env: { GITHUB_REPOSITORY: "someone/my-jobs" } }).userAgent, "job-radar/1.0 (+https://github.com/someone/my-jobs)");
  const explicit = loadConfig({ crawl: { userAgent: "custom/2.0" } }, { env: { GITHUB_REPOSITORY: "someone/my-jobs" } });
  assert.equal(explicit.userAgent, "custom/2.0");
});

test("validator catches broken values and warns about unknown keys", () => {
  const bad = loadConfig({
    location: { country: "India", excludeRegex: "(" },
    pay: { display: { divisor: 0, decimals: 9 }, fxRates: { USD: -1 }, floorFake: 1 },
    crawl: { archiveMisses: 0 },
  });
  const { errors, warnings } = validateConfig(bad);
  const joined = errors.join("\n");
  assert.match(joined, /location\.excludeRegex is not a valid regex/);
  assert.match(joined, /pay\.display\.divisor/);
  assert.match(joined, /pay\.display\.decimals/);
  assert.match(joined, /pay\.fxRates\.USD/);
  assert.match(joined, /crawl\.archiveMisses/);
  assert.match(warnings.join("\n"), /unknown key pay\.floorFake/);

  const noCurrency = validateConfig(loadConfig({ location: { country: "Germany" }, pay: { currency: "" } }));
  assert.match(noCurrency.errors.join("\n"), /pay\.currency is required/);

  const badPattern = validateConfig(loadConfig({ roles: { seniority: { includePatterns: [{ label: "x", pattern: "(" }] } } }));
  assert.match(badPattern.errors.join("\n"), /roles\.seniority\.includePatterns\[0\]\.pattern/);

  const payOff = validateConfig(loadConfig({ location: { country: "Germany" }, pay: { enabled: false, currency: "", floorAnnual: -5 } }));
  assert.equal(payOff.errors.length, 0, payOff.errors.join("\n"));
});
