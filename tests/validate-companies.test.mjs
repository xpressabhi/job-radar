import { test } from "node:test";
import assert from "node:assert/strict";
import { validateCompanies } from "../scripts/validate-companies.mjs";

const strict = {
  pay: { currency: "INR", floorAnnual: 5000000, companyFloorAnnual: 2000000, vettingRequired: true },
};
const optional = { pay: { currency: "USD", vettingRequired: false } };

const company = (overrides = {}) => ({
  name: "Example",
  ats: "gh",
  slug: "example",
  careersUrl: "https://job-boards.greenhouse.io/example",
  tier: "saas",
  location: { offices: [], remoteOk: true, note: "test" },
  payVetting: {
    generalBaseMin: 2500000,
    seniorBaseMin: 5500000,
    confidence: "estimate",
    sources: ["tier estimate 2026-09-26"],
    verifiedOn: "2026-09-26",
    notes: "test",
  },
  enabled: true,
  ...overrides,
});

test("a valid company passes in strict mode", () => {
  assert.deepEqual(validateCompanies([company()], strict), []);
});

test("missing payVetting fails only when pay.vettingRequired is true", () => {
  const { payVetting, ...rest } = company();
  assert.match(validateCompanies([rest], strict).join("\n"), /missing payVetting \(pay\.vettingRequired is true\)/);
  assert.deepEqual(validateCompanies([rest], optional), []);
  assert.deepEqual(validateCompanies([{ ...rest, enabled: false }], strict), [], "disabled companies are exempt in strict mode");
});

test("vetting amounts must clear the configured floors (annual, base currency)", () => {
  const senior = company();
  senior.payVetting.seniorBaseMin = 4500000;
  assert.match(validateCompanies([senior], strict).join("\n"), /seniorBaseMin must be a number >= 5000000 \(annual, INR\)/);

  const general = company();
  general.payVetting.generalBaseMin = 1500000;
  assert.match(validateCompanies([general], strict).join("\n"), /generalBaseMin must be a number >= 2000000/);
});

test("free-form tiers are allowed and location is optional", () => {
  assert.deepEqual(validateCompanies([company({ tier: "unicorn" })], strict), []);
  const { tier, location, ...rest } = company();
  assert.deepEqual(validateCompanies([rest], strict), []);
  assert.match(validateCompanies([company({ tier: "" })], strict).join("\n"), /tier must be a non-empty string/);
  assert.match(validateCompanies([company({ location: { offices: "nope" } })], strict).join("\n"), /location\.offices must be an array/);
});

test("duplicate ats:slug fails", () => {
  const errors = validateCompanies([company(), company({ name: "Other" })], strict);
  assert.match(errors.join("\n"), /duplicate board gh:example/);
});

test("empty sources and unknown confidence fail", () => {
  const noSources = company();
  noSources.payVetting.sources = ["  "];
  assert.match(validateCompanies([noSources], strict).join("\n"), /sources must be non-empty strings/);

  const badConfidence = company();
  badConfidence.payVetting.confidence = "probably";
  assert.match(validateCompanies([badConfidence], strict).join("\n"), /invalid confidence/);
});

test("http careersUrl fails", () => {
  assert.match(
    validateCompanies([company({ careersUrl: "http://example.com" })], strict).join("\n"),
    /careersUrl must be an https URL/,
  );
});

test("empty array fails", () => {
  assert.match(validateCompanies([], strict).join("\n"), /non-empty array/);
});
