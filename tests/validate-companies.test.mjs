import { test } from "node:test";
import assert from "node:assert/strict";
import { validateCompanies } from "../scripts/validate-companies.mjs";

const config = { payFloorBaseLpa: 50, companyPayFloorBaseLpa: 20 };

const company = (overrides = {}) => ({
  name: "Example",
  ats: "gh",
  slug: "example",
  careersUrl: "https://job-boards.greenhouse.io/example",
  tier: "saas",
  india: { offices: [], remoteOk: true, note: "test" },
  payVetting: {
    generalBaseMinLpa: 25,
    seniorBaseMinLpa: 55,
    confidence: "estimate",
    sources: ["tier estimate 2026-09-26"],
    verifiedOn: "2026-09-26",
    notes: "test",
  },
  enabled: true,
  ...overrides,
});

test("a valid company passes", () => {
  assert.deepEqual(validateCompanies([company()], config), []);
});

test("missing payVetting fails", () => {
  const { payVetting, ...rest } = company();
  assert.match(validateCompanies([rest], config).join("\n"), /missing payVetting/);
});

test("senior band below the role floor fails", () => {
  const c = company();
  c.payVetting.seniorBaseMinLpa = 45;
  assert.match(validateCompanies([c], config).join("\n"), /seniorBaseMinLpa below role floor/);
});

test("general band below the company floor fails", () => {
  const c = company();
  c.payVetting.generalBaseMinLpa = 15;
  assert.match(validateCompanies([c], config).join("\n"), /generalBaseMinLpa below company floor/);
});

test("duplicate ats:slug fails", () => {
  const errors = validateCompanies([company(), company({ name: "Other" })], config);
  assert.match(errors.join("\n"), /duplicate board gh:example/);
});

test("invalid tier fails", () => {
  assert.match(validateCompanies([company({ tier: "unicorn" })], config).join("\n"), /invalid tier/);
});

test("empty sources fail", () => {
  const c = company();
  c.payVetting.sources = ["  "];
  assert.match(validateCompanies([c], config).join("\n"), /sources must be non-empty strings/);
});

test("http careersUrl fails", () => {
  assert.match(
    validateCompanies([company({ careersUrl: "http://example.com" })], config).join("\n"),
    /careersUrl must be an https URL/,
  );
});

test("unknown confidence fails", () => {
  const c = company();
  c.payVetting.confidence = "probably";
  assert.match(validateCompanies([c], config).join("\n"), /invalid confidence/);
});

test("empty array fails", () => {
  assert.match(validateCompanies([], config).join("\n"), /non-empty array/);
});
