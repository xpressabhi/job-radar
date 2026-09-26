import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const config = JSON.parse(readFileSync(new URL("../data/config.json", import.meta.url), "utf8"));

test("pay floors match the design spec", () => {
  assert.equal(config.payFloorBaseLpa, 50);
  assert.equal(config.companyPayFloorBaseLpa, 20);
});

test("archiving needs two consecutive misses", () => {
  assert.equal(config.archiveMisses, 2);
});

test("fx table holds positive rates", () => {
  for (const [currency, rate] of Object.entries(config.fxToInr)) {
    assert.ok(rate > 0, `${currency} rate must be positive`);
  }
});

test("politeness and identity settings are present", () => {
  assert.ok(config.requestDelayMs >= 1000);
  assert.ok(config.timeoutMs >= 5000);
  assert.ok(config.retries >= 1);
  assert.match(config.userAgent, /github\.com\/xpressabhi\/job-radar/);
});
