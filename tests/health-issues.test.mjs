import { test } from "node:test";
import assert from "node:assert/strict";
import { syncHealthIssues } from "../scripts/health-issues.mjs";
import { classifyBoardResult } from "../scripts/verify-companies.mjs";

const jsonRes = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });

test("health issues: opens once at the threshold, dedupes on later runs", async () => {
  const calls = [];
  let openIssues = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? "GET", body: init.body });
    const isIssuesList = url.includes("/issues?") && !init.method;
    if (isIssuesList) return jsonRes(openIssues);
    if (url.endsWith("/issues") && init.method === "POST") {
      const issue = { number: 7, title: JSON.parse(init.body).title };
      openIssues = [...openIssues, issue];
      return jsonRes(issue, 201);
    }
    return jsonRes({}, 200);
  };
  const health = { stripetest: { consecutiveFails: 3, lastError: "HTTP 500", lastOk: null } };

  const first = await syncHealthIssues({ health, repo: "acme/jobs", token: "t", fetchImpl, threshold: 3 });
  assert.deepEqual(first.opened, ["stripetest"]);
  const posts = calls.filter((c) => c.method === "POST" && c.url.endsWith("/issues"));
  assert.equal(posts.length, 1);

  const second = await syncHealthIssues({ health, repo: "acme/jobs", token: "t", fetchImpl, threshold: 3 });
  assert.deepEqual(second.opened, []);
});

test("health issues: closes on recovery with a comment", async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? "GET" });
    if (url.includes("/issues?") && !init.method) return jsonRes([{ number: 9, title: "[board-health] stripetest" }]);
    return jsonRes({}, 200);
  };
  const res = await syncHealthIssues({
    health: { stripetest: { consecutiveFails: 0, lastError: null, lastOk: "2026-09-26" } },
    repo: "acme/jobs",
    token: "t",
    fetchImpl,
  });
  assert.deepEqual(res.closed, ["stripetest"]);
  assert.ok(calls.some((c) => c.method === "POST" && c.url.endsWith("/comments")));
  assert.ok(calls.some((c) => c.method === "PATCH" && c.url.endsWith("/issues/9")));
});

test("health issues: below threshold does nothing; missing token/repo skips", async () => {
  const fetchImpl = async () => jsonRes([]);
  const quiet = await syncHealthIssues({ health: { acme: { consecutiveFails: 2 } }, repo: "a/b", token: "t", fetchImpl });
  assert.deepEqual(quiet.opened, []);
  const skipped = await syncHealthIssues({ health: {}, repo: "", token: "", fetchImpl: async () => { throw new Error("should not be called"); } });
  assert.equal(skipped.skipped, true);
});

test("board result classification", () => {
  assert.deepEqual(classifyBoardResult({ ok: true, postings: [1, 2] }), { status: "ok", detail: "2 postings" });
  assert.equal(classifyBoardResult({ ok: true, postings: [] }).status, "empty");
  assert.equal(classifyBoardResult({ ok: false, status: 404 }).status, "dead");
  assert.equal(classifyBoardResult({ ok: false, status: 403 }).status, "blocked");
  assert.equal(classifyBoardResult({ ok: false, status: 0 }, "timeout").status, "blocked");
  assert.equal(classifyBoardResult({ ok: false, status: 400 }).status, "error");
});
