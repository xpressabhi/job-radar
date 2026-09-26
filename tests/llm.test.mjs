import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyBatch, extractJson } from "../scripts/lib/llm.mjs";

const reply = (content, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => ({ choices: [{ message: { content } }] }),
});

test("valid JSON response is parsed and validated", async () => {
  const items = [
    { title: "Member of Technical Staff", category: "ai-ml", tags: ["Agents", " python "] },
    { title: "Wizard of Kubernetes", category: "not-a-category", tags: "nope" },
  ];
  const res = await classifyBatch({
    titles: ["Member of Technical Staff", "Wizard of Kubernetes"],
    token: "t",
    fetchImpl: async () => reply(JSON.stringify({ items })),
  });
  assert.equal(res.ok, true);
  assert.equal(res.items.length, 2);
  assert.deepEqual(res.items[0], { title: "Member of Technical Staff", category: "ai-ml", tags: ["agents", "python"] });
  assert.equal(res.items[1].category, "other");
  assert.deepEqual(res.items[1].tags, []);
});

test("fenced JSON and leading prose are tolerated", () => {
  assert.deepEqual(extractJson('```json\n{"items":[]}\n```'), { items: [] });
  assert.deepEqual(extractJson('Sure! {"items":[{"title":"x","category":"backend"}]} done'), {
    items: [{ title: "x", category: "backend" }],
  });
  assert.equal(extractJson("no json here"), null);
});

test("titles not in the request are dropped", async () => {
  const res = await classifyBatch({
    titles: ["Member of Technical Staff"],
    token: "t",
    fetchImpl: async () => reply(JSON.stringify({ items: [{ title: "Something Else", category: "backend" }] })),
  });
  assert.equal(res.ok, false);
  assert.match(res.error, /no valid items/);
});

test("missing token never calls the network", async () => {
  let called = false;
  const res = await classifyBatch({ titles: ["x"], token: undefined, fetchImpl: async () => { called = true; } });
  assert.equal(res.ok, false);
  assert.equal(res.error, "no token");
  assert.equal(called, false);
});

test("HTTP errors fail cleanly", async () => {
  const res = await classifyBatch({ titles: ["x"], token: "t", fetchImpl: async () => reply("", 429) });
  assert.equal(res.ok, false);
  assert.equal(res.error, "HTTP 429");
});

test("non-JSON bodies and empty batches are handled", async () => {
  const bad = await classifyBatch({ titles: ["x"], token: "t", fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new Error("boom"); } }) });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /not JSON/);
  const empty = await classifyBatch({ titles: [], token: "t" });
  assert.equal(empty.ok, true);
  assert.deepEqual(empty.items, []);
});

test("network and timeout errors are reported, not thrown", async () => {
  const res = await classifyBatch({ titles: ["x"], token: "t", fetchImpl: async () => { const e = new Error("nope"); e.name = "TimeoutError"; throw e; } });
  assert.equal(res.ok, false);
  assert.equal(res.error, "timeout");
});
