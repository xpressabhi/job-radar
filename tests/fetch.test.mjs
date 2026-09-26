import { test } from "node:test";
import assert from "node:assert/strict";
import { createFetcher } from "../scripts/lib/fetch.mjs";

const jsonResponse = (status, data) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(data),
});

test("retries exactly once on a 500, then succeeds", async () => {
  let calls = 0;
  const fetcher = createFetcher({
    userAgent: "test",
    delayMs: 0,
    sleepImpl: async () => {},
    fetchImpl: async () => {
      calls++;
      return calls === 1 ? jsonResponse(500, { error: "boom" }) : jsonResponse(200, { jobs: [] });
    },
  });
  const res = await fetcher.getJson("https://example.test/x");
  assert.equal(res.ok, true);
  assert.equal(calls, 2);
  assert.equal(fetcher.requestCount, 2);
});

test("does not retry a 404", async () => {
  let calls = 0;
  const fetcher = createFetcher({
    userAgent: "test",
    delayMs: 0,
    sleepImpl: async () => {},
    fetchImpl: async () => {
      calls++;
      return jsonResponse(404, { error: "not found" });
    },
  });
  const res = await fetcher.getJson("https://example.test/x");
  assert.equal(res.ok, false);
  assert.equal(res.status, 404);
  assert.equal(res.error, "HTTP 404");
  assert.equal(calls, 1);
});

test("paces consecutive requests by delayMs", async () => {
  const sleeps = [];
  const fetcher = createFetcher({
    userAgent: "test",
    delayMs: 1234,
    sleepImpl: async (ms) => sleeps.push(ms),
    fetchImpl: async () => jsonResponse(200, {}),
  });
  await fetcher.getJson("https://example.test/a");
  await fetcher.getJson("https://example.test/b");
  assert.deepEqual(sleeps, [1234]);
});

test("a non-JSON 200 is a clean failure after the retry", async () => {
  let calls = 0;
  const fetcher = createFetcher({
    userAgent: "test",
    delayMs: 0,
    sleepImpl: async () => {},
    fetchImpl: async () => {
      calls++;
      return { ok: true, status: 200, text: async () => "<html>nope</html>" };
    },
  });
  const res = await fetcher.getJson("https://example.test/x");
  assert.equal(res.ok, false);
  assert.match(res.error, /not JSON/);
  assert.equal(calls, 2);
});

test("network errors are retried once and reported cleanly", async () => {
  let calls = 0;
  const fetcher = createFetcher({
    userAgent: "test",
    delayMs: 0,
    sleepImpl: async () => {},
    fetchImpl: async () => {
      calls++;
      throw new TypeError("fetch failed");
    },
  });
  const res = await fetcher.getJson("https://example.test/x");
  assert.equal(res.ok, false);
  assert.equal(calls, 2);
  assert.match(res.error, /fetch failed/);
});
