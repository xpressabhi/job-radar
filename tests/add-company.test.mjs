import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectAts, buildEntry, appendCompany, parseArgs, runAddCompany } from "../scripts/add-company.mjs";

const capture = () => {
  const lines = [];
  return {
    lines,
    log: (...a) => lines.push(a.join(" ")),
    error: (...a) => lines.push(a.join(" ")),
  };
};

function tempData({ companies = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "jr-add-company-"));
  writeFileSync(join(dir, "companies.json"), JSON.stringify(companies, null, 2));
  writeFileSync(
    join(dir, "config.json"),
    JSON.stringify({
      location: { country: "India" },
      pay: {
        currency: "INR",
        floorAnnual: 5000000,
        companyFloorAnnual: 2000000,
        vettingRequired: false,
        display: { symbol: "₹", divisor: 100000, suffix: "L", decimals: 1 },
        fxRates: { INR: 1 },
      },
    }),
  );
  return dir;
}

test("detectAts recognizes all five ATSes and their URL dialects", () => {
  assert.deepEqual(detectAts("https://job-boards.greenhouse.io/acme"), { ats: "gh", slug: "acme" });
  assert.deepEqual(detectAts("https://boards.greenhouse.io/acme/"), { ats: "gh", slug: "acme" });
  assert.deepEqual(detectAts("https://jobs.lever.co/acme"), { ats: "lever", slug: "acme" });
  assert.deepEqual(detectAts("https://jobs.ashbyhq.com/acme/some-role-id"), { ats: "ashby", slug: "acme" });
  assert.deepEqual(detectAts("https://careers.smartrecruiters.com/Acme"), { ats: "sr", slug: "Acme" });
  assert.deepEqual(detectAts("https://apply.workable.com/acme/"), { ats: "workable", slug: "acme" });
  assert.deepEqual(detectAts("https://jobs.workable.com/company/acme/j/ABC123"), { ats: "workable", slug: "acme" });

  assert.equal(detectAts("https://example.com/careers"), null);
  assert.equal(detectAts("not a url"), null);
  assert.equal(detectAts("https://jobs.lever.co/"), null, "no slug");
});

test("buildEntry produces a valid, minimal entry", () => {
  const entry = buildEntry({ ats: "lever", slug: "acme", now: new Date("2026-09-26T00:00:00Z") });
  assert.deepEqual(entry, {
    name: "Acme",
    ats: "lever",
    slug: "acme",
    careersUrl: "https://jobs.lever.co/acme",
    enabled: true,
  });

  const vetted = buildEntry({ ats: "gh", slug: "acme", name: "Acme Inc", tier: "saas", general: 2500000, senior: 5500000, now: new Date("2026-09-26T00:00:00Z") });
  assert.equal(vetted.name, "Acme Inc");
  assert.equal(vetted.tier, "saas");
  assert.equal(vetted.payVetting.generalBaseMin, 2500000);
  assert.equal(vetted.payVetting.seniorBaseMin, 5500000);
  assert.equal(vetted.payVetting.confidence, "estimate");
  assert.equal(vetted.payVetting.verifiedOn, "2026-09-26");
  assert.match(vetted.payVetting.sources[0], /add-company/);
});

test("appendCompany adds, refuses duplicates, and updates explicitly", () => {
  const first = { name: "Acme", ats: "lever", slug: "acme", enabled: true };
  const added = appendCompany([], first);
  assert.equal(added.action, "added");
  assert.equal(added.companies.length, 1);

  const dupe = appendCompany([first], { ...first, name: "Acme Again" });
  assert.equal(dupe.action, "duplicate");
  assert.equal(dupe.companies.length, 1, "unchanged");

  const updated = appendCompany([first], { ...first, name: "Acme Again" }, { update: true });
  assert.equal(updated.action, "updated");
  assert.equal(updated.companies[0].name, "Acme Again");
});

test("parseArgs handles flags and positionals", () => {
  const args = parseArgs(["--ats", "gh", "--name", "Acme", "--no-verify", "--dry-run", "--data-dir", "/tmp/x", "acme"]);
  assert.equal(args.input, "acme");
  assert.equal(args.ats, "gh");
  assert.equal(args.name, "Acme");
  assert.equal(args.verify, false);
  assert.equal(args.dryRun, true);
  assert.equal(args.dataDir, "/tmp/x");
});

test("runAddCompany adds an entry after a successful board check", async () => {
  const dir = tempData();
  const io = capture();
  const code = await runAddCompany(["--data-dir", dir, "https://jobs.lever.co/acme", "--name", "Acme"], io, {
    verify: async () => ({ ok: true, count: 7 }),
  });
  assert.equal(code, 0, io.lines.join("\n"));
  assert.match(io.lines.join("\n"), /board ok — 7 posting/);
  const companies = JSON.parse(readFileSync(join(dir, "companies.json"), "utf8"));
  assert.equal(companies.length, 1);
  assert.equal(companies[0].slug, "acme");
});

test("runAddCompany rejects dead boards and unknown URLs", async () => {
  const dir = tempData();
  const io = capture();
  const code = await runAddCompany(["--data-dir", dir, "https://jobs.lever.co/dead"], io, {
    verify: async () => ({ ok: false, error: "HTTP 404" }),
  });
  assert.equal(code, 1);
  assert.match(io.lines.join("\n"), /board check failed/);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "companies.json"), "utf8")), []);

  const io2 = capture();
  assert.equal(await runAddCompany(["--data-dir", dir, "https://example.com/jobs"], io2), 2);
  assert.match(io2.lines.join("\n"), /could not detect the ATS/);
});

test("runAddCompany refuses duplicates without --update and replaces with it", async () => {
  const dir = tempData({ companies: [{ name: "Acme", ats: "lever", slug: "acme", careersUrl: "https://jobs.lever.co/acme", enabled: true }] });
  const io = capture();
  assert.equal(await runAddCompany(["--data-dir", dir, "--no-verify", "https://jobs.lever.co/acme"], io), 1);
  assert.match(io.lines.join("\n"), /already exists .*--update/);

  const io2 = capture();
  assert.equal(await runAddCompany(["--data-dir", dir, "--no-verify", "--update", "--name", "Acme Updated", "https://jobs.lever.co/acme"], io2), 0, io2.lines.join("\n"));
  const companies = JSON.parse(readFileSync(join(dir, "companies.json"), "utf8"));
  assert.equal(companies.length, 1);
  assert.equal(companies[0].name, "Acme Updated");
});

test("runAddCompany --dry-run writes nothing and reports the entry", async () => {
  const dir = tempData();
  const io = capture();
  const code = await runAddCompany(["--data-dir", dir, "--no-verify", "--dry-run", "https://jobs.ashbyhq.com/acme", "--tier", "saas"], io);
  assert.equal(code, 0, io.lines.join("\n"));
  assert.match(io.lines.join("\n"), /would add/);
  assert.match(io.lines.join("\n"), /"ats": "ashby"/);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "companies.json"), "utf8")), []);
});

test("runAddCompany validates vetting amounts when given", async () => {
  const dir = tempData();
  const io = capture();
  const tooLow = await runAddCompany(["--data-dir", dir, "--no-verify", "--senior", "4000000", "https://jobs.lever.co/acme"], io);
  assert.equal(tooLow, 1);
  assert.match(io.lines.join("\n"), /seniorBaseMin must be a number >= 5000000/);

  const io2 = capture();
  const ok = await runAddCompany(["--data-dir", dir, "--no-verify", "--general", "2500000", "--senior", "5500000", "https://jobs.lever.co/acme"], io2);
  assert.equal(ok, 0, io2.lines.join("\n"));
  assert.match(io2.lines.join("\n"), /added lever:acme/);
});
