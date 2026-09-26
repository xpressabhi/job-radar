import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyBatch, extractJson } from "../scripts/lib/llm.mjs";

const OPTS = { apiKey: "k", baseUrl: "https://llm.example.test/v1", model: "test-model" };

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
    ...OPTS,
    fetchImpl: async () => reply(JSON.stringify({ items })),
  });
  assert.equal(res.ok, true);
  assert.equal(res.items.length, 2);
  assert.deepEqual(res.items[0], { title: "Member of Technical Staff", category: "ai-ml", tags: ["agents", "python"] });
  assert.equal(res.items[1].category, "other");
  assert.deepEqual(res.items[1].tags, []);
});

test("the request goes to the configured OpenAI-compatible endpoint", async () => {
  let seen = null;
  await classifyBatch({
    titles: ["Senior Backend Engineer"],
    ...OPTS,
    fetchImpl: async (url, init) => {
      seen = { url, init, body: JSON.parse(init.body) };
      return reply(JSON.stringify({ items: [{ title: "Senior Backend Engineer", category: "backend", tags: [] }] }));
    },
  });
  assert.equal(seen.url, "https://llm.example.test/v1/chat/completions");
  assert.equal(seen.init.method, "POST");
  assert.equal(seen.init.headers.Authorization, "Bearer k");
  assert.equal(seen.body.model, "test-model");
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
    ...OPTS,
    fetchImpl: async () => reply(JSON.stringify({ items: [{ title: "Something Else", category: "backend" }] })),
  });
  assert.equal(res.ok, false);
  assert.match(res.error, /no valid items/);
});

test("missing key or endpoint config never calls the network", async () => {
  let called = false;
  const noKey = await classifyBatch({ titles: ["x"], baseUrl: OPTS.baseUrl, model: OPTS.model, fetchImpl: async () => { called = true; } });
  assert.equal(noKey.ok, false);
  assert.match(noKey.error, /no API key/);
  const noEndpoint = await classifyBatch({ titles: ["x"], apiKey: "k", fetchImpl: async () => { called = true; } });
  assert.equal(noEndpoint.ok, false);
  assert.match(noEndpoint.error, /not configured/);
  assert.equal(called, false);
});

test("HTTP errors fail cleanly", async () => {
  const res = await classifyBatch({ titles: ["x"], ...OPTS, fetchImpl: async () => reply("", 429) });
  assert.equal(res.ok, false);
  assert.equal(res.error, "HTTP 429");
});

test("non-JSON bodies and empty batches are handled", async () => {
  const bad = await classifyBatch({
    titles: ["x"],
    ...OPTS,
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new Error("boom"); } }),
  });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /not JSON/);
  const empty = await classifyBatch({ titles: [], ...OPTS });
  assert.equal(empty.ok, true);
  assert.deepEqual(empty.items, []);
});

test("network and timeout errors are reported, not thrown", async () => {
  const res = await classifyBatch({
    titles: ["x"],
    ...OPTS,
    fetchImpl: async () => {
      const e = new Error("nope");
      e.name = "TimeoutError";
      throw e;
    },
  });
  assert.equal(res.ok, false);
  assert.equal(res.error, "timeout");
});
