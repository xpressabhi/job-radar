import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyOne,
  classifyPosting,
  extractTags,
  loadCache,
  saveCache,
  applyClassification,
  MAX_TAGS,
} from "../scripts/lib/taxonomy.mjs";

test("titles map to the expected categories", () => {
  const cases = [
    ["Senior Frontend Engineer", "frontend"],
    ["Staff Backend Engineer", "backend"],
    ["Machine Learning Engineer", "ai-ml"],
    ["Applied Scientist, LLM Evals", "ai-ml"],
    ["Site Reliability Engineer", "platform-infra"],
    ["Engineering Manager, Platform", "engineering-leadership"],
    ["Senior Manager, Customer Engineering", "engineering-leadership"],
    ["Senior Android Engineer", "mobile"],
    ["Security Engineer", "security"],
    ["QA Automation Engineer", "qa"],
    ["Embedded Software Engineer", "embedded"],
    ["Senior Data Engineer", "data"],
    ["Full Stack Engineer", "fullstack"],
    ["Member of Technical Staff", "other"],
  ];
  for (const [title, expected] of cases) {
    assert.equal(classifyOne(title, ""), expected, title);
  }
});

test("description is the fallback when the title is uninformative", () => {
  assert.equal(classifyOne("Member of Technical Staff", "You will build React applications and design systems."), "frontend");
  assert.equal(classifyOne("Member of Technical Staff", "Own our Kubernetes platform and observability."), "platform-infra");
});

test("stack tags are extracted, lowercased, capped, and deduped", () => {
  const tags = extractTags("Senior Engineer", "Python, Kubernetes, and React. Python again. AWS, Docker, Kafka, Spark, Airflow, Snowflake, Databricks, GraphQL");
  assert.ok(tags.includes("python"));
  assert.ok(tags.includes("kubernetes"));
  assert.ok(tags.includes("react"));
  assert.ok(tags.length <= MAX_TAGS);
  assert.equal(new Set(tags).size, tags.length);
  for (const t of tags) assert.equal(t, t.toLowerCase());
});

test("classifyPosting flags rule misses for the LLM fallback", () => {
  const miss = classifyPosting({ title: "Member of Technical Staff", description: "" });
  assert.equal(miss.needsClassify, true);
  const hit = classifyPosting({ title: "Senior React Engineer", description: "" });
  assert.equal(hit.needsClassify, false);
  assert.equal(hit.category, "frontend");
});

test("cache hits bypass rules and survive save/load", () => {
  const cache = loadCache({});
  saveCache(cache, "Member of Technical Staff", "", { category: "ai-ml", tags: ["agents"] });
  const reloaded = loadCache(JSON.parse(JSON.stringify(cache)));
  const { classified } = applyClassification([{ title: "Member of Technical Staff", description: "" }], reloaded);
  assert.equal(classified[0].category, "ai-ml");
  assert.equal(classified[0].needsClassify, false);
  assert.deepEqual(classified[0].tags, ["agents"]);
});

test("invalid cached categories fall back to rules", () => {
  const cache = { "member of technical staff": { category: "wizardry", tags: [] } };
  const { classified } = applyClassification([{ title: "Member of Technical Staff", description: "React work" }], cache);
  assert.equal(classified[0].category, "frontend");
});

test("loadCache tolerates junk input", () => {
  assert.deepEqual(loadCache(null), {});
  assert.deepEqual(loadCache([]), {});
  assert.deepEqual(loadCache("nope"), {});
});
