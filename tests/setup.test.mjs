import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs, pruneDefaults, runSetup } from "../scripts/setup.mjs";
import { DEFAULTS, loadConfigFile, validateConfig } from "../scripts/lib/config.mjs";

const capture = () => {
  const lines = [];
  return { lines, log: (...a) => lines.push(a.join(" ")), error: (...a) => lines.push(a.join(" ")) };
};

function tempData(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), "jr-setup-"));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), typeof content === "string" ? content : JSON.stringify(content, null, 2));
  }
  return dir;
}

const readJson = (dir, name) => JSON.parse(readFileSync(join(dir, name), "utf8"));

test("parseArgs collects repeated --company flags", () => {
  const args = parseArgs(["--yes", "--country", "Germany", "--company", "https://jobs.lever.co/a", "--company", "https://jobs.lever.co/b", "--dry-run"]);
  assert.equal(args.yes, true);
  assert.equal(args.country, "Germany");
  assert.deepEqual(args.companies, ["https://jobs.lever.co/a", "https://jobs.lever.co/b"]);
  assert.equal(args.dryRun, true);
});

test("pruneDefaults keeps overrides and drops default-equal values", () => {
  const pruned = pruneDefaults(
    { site: { name: "Job Radar", tagline: "custom" }, location: { country: "Germany", countryCode: null }, pay: { floorAnnual: 0 } },
    DEFAULTS,
  );
  assert.deepEqual(pruned, { site: { tagline: "custom" }, location: { country: "Germany" } });
  assert.equal(pruneDefaults({}, DEFAULTS), undefined);
});

test("setup --yes writes a valid, sparse config and an empty company list", async () => {
  const dir = tempData();
  const io = capture();
  const code = await runSetup(["--yes", "--country", "Germany", "--data-dir", dir], io);
  assert.equal(code, 0, io.lines.join("\n"));

  const written = loadConfigFile(join(dir, "config.json"));
  assert.equal(written.location.country, "Germany");
  assert.deepEqual(validateConfig(written).errors, []);
  assert.deepEqual(readJson(dir, "companies.json"), []);

  const raw = readJson(dir, "config.json");
  assert.equal(raw.pay, undefined, "default pay values are pruned from the override file");
  assert.equal(raw.location.country, "Germany");
});

test("setup backs up existing files before writing", async () => {
  const dir = tempData({
    "config.json": { location: { country: "India" } },
    "companies.json": [{ name: "Old Co", ats: "gh", slug: "old", enabled: true }],
  });
  const io = capture();
  const code = await runSetup(["--yes", "--country", "India", "--country-code", "IN", "--data-dir", dir], io);
  assert.equal(code, 0, io.lines.join("\n"));
  assert.deepEqual(readJson(dir, "config.json.bak"), { location: { country: "India" } });
  assert.equal(readJson(dir, "companies.json.bak")[0].name, "Old Co");
  assert.equal(readJson(dir, "companies.json")[0].name, "Old Co", "companies kept by default");
});

test("setup --dry-run writes nothing", async () => {
  const dir = tempData();
  const io = capture();
  const code = await runSetup(["--yes", "--country", "India", "--dry-run", "--data-dir", dir], io);
  assert.equal(code, 0, io.lines.join("\n"));
  assert.match(io.lines.join("\n"), /dry run \(no files written\)/);
  assert.ok(!existsSync(join(dir, "config.json")));
  assert.ok(!existsSync(join(dir, "companies.json")));
});

test("setup without a country fails cleanly", async () => {
  const dir = tempData();
  const io = capture();
  const code = await runSetup(["--yes", "--data-dir", dir], io);
  assert.equal(code, 2);
  assert.match(io.lines.join("\n"), /home country is required/);
});

test("setup honors scripted interactive answers", async () => {
  const dir = tempData();
  const io = capture();
  const script = {
    "Site name": "Discovery Radar",
    "Home country": "Germany",
    "Country code": "DE",
    "Cities": "Berlin, Munich",
    "unrestricted-remote": "yes",
    "Gate roles": "yes",
    "Pay currency": "EUR",
    "Senior base floor": "90000",
    "Company general floor": "60000",
    "FX rates": "USD:1.08, GBP:1.27",
    "Extra seniority keywords": "founding engineer, member of technical staff",
  };
  const ask = async (question, fallback) => {
    const key = Object.keys(script).find((k) => question.includes(k));
    return key ? script[key] : fallback;
  };
  const code = await runSetup(["--data-dir", dir], io, { ask });
  assert.equal(code, 0, io.lines.join("\n"));

  const written = loadConfigFile(join(dir, "config.json"));
  assert.equal(written.site.name, "Discovery Radar");
  assert.equal(written.location.country, "Germany");
  assert.equal(written.location.countryCode, "DE");
  assert.deepEqual(written.location.cities, { berlin: "Berlin", munich: "Munich" });
  assert.equal(written.pay.currency, "EUR");
  assert.equal(written.pay.floorAnnual, 90000);
  assert.equal(written.pay.display.symbol, "€");
  assert.deepEqual(written.pay.fxRates, { USD: 1.08, GBP: 1.27 });
  assert.deepEqual(written.roles.seniority.includeKeywords, ["founding engineer", "member of technical staff"]);
  assert.deepEqual(validateConfig(written).errors, []);
});

test("setup imports --company URLs after verification", async () => {
  const dir = tempData();
  const io = capture();
  const code = await runSetup(["--yes", "--country", "India", "--company", "https://jobs.lever.co/acme", "--data-dir", dir], io, {
    verify: async () => ({ ok: true, count: 4 }),
  });
  assert.equal(code, 0, io.lines.join("\n"));
  assert.match(io.lines.join("\n"), /board ok — lever:acme \(4 postings\)/);
  const companies = readJson(dir, "companies.json");
  assert.equal(companies.length, 1);
  assert.equal(companies[0].slug, "acme");
});

test("setup aborts on a failed board check without writing", async () => {
  const dir = tempData();
  const io = capture();
  const code = await runSetup(["--yes", "--country", "India", "--company", "https://jobs.lever.co/dead", "--data-dir", dir], io, {
    verify: async () => ({ ok: false, error: "HTTP 404" }),
  });
  assert.equal(code, 1);
  assert.match(io.lines.join("\n"), /board check failed/);
  assert.ok(!existsSync(join(dir, "config.json")));
  assert.ok(!existsSync(join(dir, "companies.json")));
});
