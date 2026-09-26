// Category taxonomy: deterministic keyword rules over title (first) then description,
// stack-tag extraction, and the classification cache used by the LLM fallback.
import { cleanTitle } from "./normalize.mjs";

export const CATEGORIES = [
  "ai-ml",
  "backend",
  "frontend",
  "fullstack",
  "platform-infra",
  "data",
  "mobile",
  "security",
  "qa",
  "embedded",
  "engineering-leadership",
  "other",
];

// Priority order matters: the first match wins, titles are scanned before descriptions.
const RULES = [
  ["engineering-leadership", /\b(engineering manager|director of engineering|head of engineering|vp engineering|vice president,? engineering)\b/i],
  ["ai-ml", /\b(ai|ml|machine learning|deep learning|llm|genai|generative|nlp|computer vision|applied scientist|research engineer(?:ing)?|research scientist|agentic|agents?|rag|recommendation|perception|multimodal)\b/i],
  ["security", /\b(security|cyber|infosec|appsec|threat|penetration|soc analyst)\b/i],
  ["mobile", /\b(ios|android|mobile)\b/i],
  ["frontend", /\b(frontend|front[- ]end|front end|react|web engineer|ui engineer|design engineer)\b/i],
  ["fullstack", /\bfull[- ]?stack\b/i],
  ["backend", /\b(backend|back[- ]end|back end|server|api|microservices|distributed systems|payments engineer|services engineer)\b/i],
  ["data", /\b(data engineer|data platform|analytics engineer|data scientist|data architect|database|warehouse|etl|bi engineer|business intelligence)\b/i],
  ["platform-infra", /\b(platform|infrastructure|infra|sre|site reliability|devops|cloud|kubernetes|systems|network|release engineer|database reliability)\b/i],
  ["qa", /\b(qa|quality|test|automation|sdet)\b/i],
  ["embedded", /\b(embedded|firmware|kernel|driver|robotics|hardware)\b/i],
];

const TAG_MAP = [
  ["react", /\breact\b/i],
  ["next.js", /\bnext\.?js\b/i],
  ["typescript", /\btypescript\b/i],
  ["javascript", /\bjavascript\b/i],
  ["node.js", /\bnode\.?js\b/i],
  ["python", /\bpython\b/i],
  ["java", /\bjava\b/i],
  ["go", /\bgolang\b|\bgo\b(?:\s*\/|\s*engineer|\s*developer)/i],
  ["rust", /\brust\b/i],
  ["c++", /\bc\+\+\b/i],
  ["kotlin", /\bkotlin\b/i],
  ["swift", /\bswift\b/i],
  ["kubernetes", /\bkubernetes|\bk8s\b/i],
  ["docker", /\bdocker\b/i],
  ["aws", /\baws\b|amazon web services/i],
  ["gcp", /\bgcp\b|google cloud/i],
  ["azure", /\bazure\b/i],
  ["terraform", /\bterraform\b/i],
  ["graphql", /\bgraphql\b/i],
  ["grpc", /\bgrpc\b/i],
  ["kafka", /\bkafka\b/i],
  ["spark", /\bspark\b/i],
  ["airflow", /\bairflow\b/i],
  ["snowflake", /\bsnowflake\b/i],
  ["databricks", /\bdatabricks\b/i],
  ["langchain", /\blangchain\b/i],
  ["rag", /\brag\b|retrieval.augmented/i],
  ["llm-evals", /\bevals?\b|golden set|llm.as.judge/i],
  ["pytorch", /\bpytorch\b/i],
  ["tensorflow", /\btensorflow\b/i],
  ["mlops", /\bmlops\b/i],
  ["agents", /\bagents?\b|agentic/i],
  ["mcp", /\bmcp\b|model context protocol/i],
  ["distributed-systems", /\bdistributed systems?\b/i],
  ["microservices", /\bmicroservices?\b/i],
  ["observability", /\bobservability\b|datadog|prometheus|grafana/i],
  ["ci-cd", /\bci\/cd\b|continuous (integration|delivery|deployment)/i],
  ["accessibility", /\baccessibility\b|wcag|a11y/i],
  ["performance", /\bperformance\b|latency|core web vitals/i],
  ["postgres", /\bpostgres(?:ql)?\b/i],
  ["mongodb", /\bmongodb\b/i],
  ["react-native", /\breact native\b/i],
  ["flutter", /\bflutter\b/i],
];

export const MAX_TAGS = 8;

export function classifyOne(title, description) {
  const t = String(title ?? "");
  const d = String(description ?? "");
  for (const [category, re] of RULES) {
    if (re.test(t)) return category;
  }
  for (const [category, re] of RULES) {
    if (re.test(d)) return category;
  }
  return "other";
}

export function extractTags(title, description) {
  const text = `${title ?? ""}\n${description ?? ""}`;
  const tags = [];
  for (const [tag, re] of TAG_MAP) {
    if (tags.length >= MAX_TAGS) break;
    if (re.test(text)) tags.push(tag);
  }
  return tags;
}

export function classifyPosting(posting) {
  const category = classifyOne(posting.title, posting.description);
  return {
    category,
    tags: extractTags(posting.title, posting.description),
    needsClassify: category === "other",
  };
}

// ---------- classification cache ----------

export const cacheKey = (title) => cleanTitle(title).toLowerCase();

export function loadCache(raw) {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? { ...raw } : {};
}

export function saveCache(cache, title, department, value) {
  cache[cacheKey(title)] = { category: value.category, tags: value.tags ?? [], department: department ?? "", at: new Date().toISOString() };
  return cache;
}

/**
 * Applies cache → rules to each posting. Postings still categorized `other` and not in the
 * cache are marked `needsClassify` for the LLM fallback.
 */
export function applyClassification(postings, cache) {
  const classified = [];
  for (const posting of postings) {
    const key = cacheKey(posting.title);
    const hit = cache[key];
    if (hit && CATEGORIES.includes(hit.category)) {
      classified.push({ ...posting, category: hit.category, tags: hit.tags?.length ? hit.tags : extractTags(posting.title, posting.description), needsClassify: false });
      continue;
    }
    const rules = classifyPosting(posting);
    classified.push({ ...posting, ...rules });
  }
  return { classified };
}
