import { test } from "node:test";
import assert from "node:assert/strict";
import { profileKeywords, scoreJob, shortlist, renderMarkdown } from "../scripts/personal-rank.mjs";

const profile = {
  basics: { location: "Hyderabad, India", headline: "Staff Software Engineer — AI agent platforms, React/TypeScript" },
  skills: { "AI & Agentic Engineering": ["AI agents", "MCP workflows", "RAG"], Frontend: ["React", "TypeScript"] },
  experience: [{ stack: ["Python", "Java"] }],
  capabilityCards: [{ tags: ["LLM evals"] }],
};

const job = (overrides = {}) => ({
  id: `gh:acme:${Math.random()}`,
  status: "active",
  title: "Senior Backend Engineer",
  company: "Acme",
  category: "backend",
  tags: ["python", "kubernetes"],
  location: { cities: ["Bengaluru"], indiaScope: "located" },
  pay: { published: false, vettedSeniorMinLpa: 55 },
  firstSeen: "2026-09-26T02:00:00.000Z",
  url: "https://example.test/job",
  ...overrides,
});

test("profileKeywords flattens skills, stacks, tags, and headline", () => {
  const kw = profileKeywords(profile);
  for (const expected of ["python", "react", "typescript", "mcp", "rag"]) assert.ok(kw.includes(expected), expected);
  assert.ok(kw.every((k) => k.length > 2));
});

test("home city, remote-India, category priors and published pay boost the score", () => {
  const kw = profileKeywords(profile);
  const home = scoreJob(job({ location: { cities: ["Hyderabad"], indiaScope: "located" } }), profile, kw);
  const away = scoreJob(job({ location: { cities: ["Bengaluru"], indiaScope: "located" } }), profile, kw);
  assert.ok(home.score > away.score);

  const remoteIndia = scoreJob(job({ location: { cities: [], indiaScope: "remote_india" } }), profile, kw);
  assert.equal(remoteIndia.score, away.score + 2);

  const ai = scoreJob(job({ category: "ai-ml" }), profile, kw);
  assert.ok(ai.score > away.score);

  const paid = scoreJob(job({ pay: { published: true, baseMinLpa: 60, baseMaxLpa: 70 } }), profile, kw);
  assert.equal(paid.score, away.score + 1);

  const python = scoreJob(job({ tags: ["python"] }), profile, kw);
  assert.ok(python.matches.includes("python"));
});

test("shortlist filters archived jobs, sorts by score, and caps the limit", () => {
  const jobs = [
    job({ id: "a", title: "Senior Backend Engineer", tags: ["python", "mcp"], location: { cities: ["Hyderabad"], indiaScope: "located" } }),
    job({ id: "b", title: "Staff Frontend Engineer", tags: ["react"], location: { cities: [], indiaScope: "remote_global" } }),
    job({ id: "c", status: "archived", title: "Principal Engineer", tags: ["python"] }),
  ];
  const rows = shortlist({ jobs, profile, limit: 1 });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].job.id, "a");
  const all = shortlist({ jobs, profile, limit: 10 });
  assert.equal(all.length, 2);
  assert.ok(all.every((r) => r.job.status === "active"));
});

test("markdown output has the table, links, and honest pay text", () => {
  const rows = shortlist({ jobs: [job({ id: "a" })], profile, limit: 5 });
  const md = renderMarkdown(rows, "2026-09-26T02:00:00.000Z");
  assert.match(md, /# Personal shortlist/);
  assert.match(md, /\| 1 \| \[Senior Backend Engineer\]\(https:\/\/example\.test\/job\) \| Acme \|/);
  assert.match(md, /vetted ≥₹55L base/);
  const paidMd = renderMarkdown(shortlist({ jobs: [job({ id: "p", pay: { published: true, baseMinLpa: 60, baseMaxLpa: 70, totalOnly: true } })], profile }), "now");
  assert.match(paidMd, /₹60–70L total/);
});
