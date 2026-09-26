import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { annualize, toLpa, convertToLpa, parseRangeString } from "../scripts/lib/fx.mjs";
import { loadConfigFile } from "../scripts/lib/config.mjs";

const config = loadConfigFile(new URL("./fixtures/config.json", import.meta.url));

test("annualize understands ATS interval dialects", () => {
  assert.equal(annualize(100, "per-year-salary"), 100);
  assert.equal(annualize(100, "1 YEAR"), 100);
  assert.equal(annualize(100, "yearly"), 100);
  assert.equal(annualize(100, "per-month"), 1200);
  assert.equal(annualize(100, "1 MONTH"), 1200);
  assert.equal(annualize(100, "per-hour-wage"), 208000);
  assert.equal(annualize(100, "fortnight"), null);
});

test("toLpa rounds down against the employee", () => {
  // 189000 USD x 87 = 164.43L -> 164.4
  assert.equal(toLpa(189000, "USD", config.fxToInr), 164.4);
  // 60001 USD x 87 = 52.20087L -> 52.2
  assert.equal(toLpa(60001, "USD", config.fxToInr), 52.2);
  assert.equal(toLpa(215000, "CAD", config.fxToInr), 137.6);
  assert.equal(toLpa(5500000, "INR", config.fxToInr), 55);
  assert.equal(toLpa(1000, "BRL", config.fxToInr), null);
});

test("convertToLpa combines annualization and conversion (EUR/GBP fixtures)", () => {
  assert.equal(convertToLpa(60000, "EUR", "per-year-salary", config.fxToInr), 57); // 95 x 60000 = 57L
  assert.equal(convertToLpa(50000, "GBP", "per-year-salary", config.fxToInr), 56); // 112 x 50000 = 56L
  assert.equal(convertToLpa(10000, "EUR", "per-month", config.fxToInr), 114); // 95 x 120000 = 114L
});

test("parseRangeString handles Ashby-style summaries", () => {
  assert.deepEqual(parseRangeString("CA$215K – CA$310K • Offers Equity"), { min: 215000, max: 310000, currency: "CAD" });
  assert.deepEqual(parseRangeString("$200,000 - $250,000"), { min: 200000, max: 250000, currency: "USD" });
  assert.deepEqual(parseRangeString("₹55L – ₹70L base"), { min: 5500000, max: 7000000, currency: "INR" });
  assert.deepEqual(parseRangeString("£80K"), { min: 80000, max: 80000, currency: "GBP" });
  assert.equal(parseRangeString("Offers Equity"), null);
  assert.equal(parseRangeString(""), null);
});
