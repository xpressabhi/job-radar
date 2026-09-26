import { test } from "node:test";
import assert from "node:assert/strict";
import { stripHtml } from "../scripts/lib/html.mjs";

test("stripHtml collapses whitespace and decodes entities", () => {
  assert.equal(stripHtml("<p>Hello&nbsp;<b>World</b> &amp; co</p>"), "Hello World & co");
});

test("stripHtml handles escaped HTML (Greenhouse regression)", () => {
  assert.equal(stripHtml("&lt;div&gt;&lt;strong&gt;About&lt;/strong&gt;&lt;/div&gt;"), "About");
});

test("stripHtml is null-safe", () => {
  assert.equal(stripHtml(null), "");
  assert.equal(stripHtml(undefined), "");
});
