import { test } from "node:test";
import assert from "node:assert/strict";
import {
  convertToBase,
  roundDownTo,
  displayStep,
  formatMoney,
  formatBand,
  lpaToAnnual,
  isLegacyPay,
  migrateLegacyPay,
  migrateLegacyEvidence,
} from "../scripts/lib/money.mjs";
import { convertToLpa } from "../scripts/lib/fx.mjs";

const INR = { rates: { USD: 87, EUR: 95, GBP: 112 }, base: "INR" };

test("roundDownTo rounds conservatively to the step", () => {
  assert.equal(roundDownTo(5220087, 10000), 5220000);
  assert.equal(roundDownTo(59.9, 1), 59);
  assert.equal(roundDownTo(1000000, 1), 1000000);
});

test("convertToBase converts to annual base currency", () => {
  assert.equal(convertToBase(6000000, "INR", "year", INR, 10000), 6000000);
  assert.equal(convertToBase(60001, "USD", "year", INR, 10000), 5220000);
  assert.equal(convertToBase(10000, "EUR", "per-month", INR, 10000), 11400000);
  assert.equal(convertToBase(50000, "GBP", "per-year-salary", INR, 10000), 5600000);
  assert.equal(convertToBase(60000, "BRL", "year", INR, 10000), null, "unknown currency");
  assert.equal(convertToBase(null, "USD", "year", INR, 10000), null, "missing amount");
  assert.equal(convertToBase(100, "USD", "fortnight", INR, 10000), null, "unknown interval");
});

test("INR conversion is parity with the legacy LPA math", () => {
  for (const amount of [1, 60001, 10000, 215000, 987654]) {
    const lpa = convertToLpa(amount, "USD", "year", INR.rates);
    assert.equal(convertToBase(amount, "USD", "year", INR, 10000), Math.round(lpa * 100000), `USD ${amount}`);
  }
  const annual = 12345678;
  assert.equal(convertToBase(annual, "INR", "year", INR, 10000), Math.floor(annual / 10000) * 10000);
});

test("displayStep derives from divisor and decimals", () => {
  assert.equal(displayStep({ divisor: 100000, decimals: 1 }), 10000);
  assert.equal(displayStep({ divisor: 1, decimals: 0 }), 1);
  assert.equal(displayStep({ divisor: 1000, decimals: 1 }), 100);
});

test("formatMoney renders lakh-style and plain styles", () => {
  const lakhs = { symbol: "₹", divisor: 100000, suffix: "L", decimals: 1 };
  assert.equal(formatMoney(7000000, lakhs), "₹70L");
  assert.equal(formatMoney(5050000, lakhs), "₹50.5L");
  assert.equal(formatMoney(0, lakhs), "₹0L");

  const usd = { symbol: "$", divisor: 1, suffix: "", decimals: 0 };
  assert.equal(formatMoney(185000, usd), "$185,000");
  assert.equal(formatMoney(1234, usd), "$1,234");

  const k = { symbol: "$", divisor: 1000, suffix: "k", decimals: 0 };
  assert.equal(formatMoney(185000, k), "$185k");

  assert.equal(formatMoney(null, usd), "");
  assert.equal(formatMoney(Number.NaN, usd), "");
});

test("formatBand handles ranges and single values", () => {
  const lakhs = { symbol: "₹", divisor: 100000, suffix: "L", decimals: 1 };
  assert.equal(formatBand(5000000, 7000000, lakhs), "₹50–70L");
  assert.equal(formatBand(5000000, 5000000, lakhs), "₹50L");
  assert.equal(formatBand(5000000, null, lakhs), "₹50L");
  assert.equal(formatBand(null, null, lakhs), "");
});

test("legacy pay and evidence migrate to annual amounts", () => {
  assert.equal(lpaToAnnual(164.4), 16440000);
  assert.equal(lpaToAnnual("50"), null);

  const legacyPay = { published: true, currency: "INR", baseMinLpa: 164.4, baseMaxLpa: 215, totalOnly: false };
  assert.equal(isLegacyPay(legacyPay), true);
  assert.deepEqual(migrateLegacyPay(legacyPay), {
    published: true,
    currency: "INR",
    baseMin: 16440000,
    baseMax: 21500000,
    totalOnly: false,
  });

  const current = { published: false, vettedMin: 7000000 };
  assert.equal(isLegacyPay(current), false);
  assert.equal(migrateLegacyPay(current), current, "no-op for the new shape");

  const evidence = { url: "https://x", baseMinLpa: 50, baseMaxLpa: 60, totalOnly: false, currency: "INR" };
  assert.deepEqual(migrateLegacyEvidence(evidence), {
    url: "https://x",
    baseMin: 5000000,
    baseMax: 6000000,
    totalOnly: false,
    currency: "INR",
  });
});
