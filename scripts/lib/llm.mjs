// LLM fallback classifier via GitHub Models (free in Actions with the built-in GITHUB_TOKEN).
// Strict JSON out, per-item validation, bounded batches, and a clean no-token/no-network path.
import { CATEGORIES } from "./taxonomy.mjs";

const ENDPOINT = "https://models.github.ai/inference/chat/completions";
const DEFAULT_MODEL = "openai/gpt-4o-mini";

const SYSTEM_PROMPT = `You classify software job titles for a jobs board.
Return ONLY JSON: {"items":[{"title":"<exact input title>","category":"<one of: ${CATEGORIES.join(", ")}>","tags":["<0-5 lowercase stack tags>"]}]}
Rules: engineering-leadership beats other categories for manager/director titles. Use "other" only when nothing fits. Tags are technologies (react, python, kubernetes, llm-evals...), never companies or locations.`;

export async function classifyBatch({ titles, token, model = DEFAULT_MODEL, fetchImpl = globalThis.fetch, timeoutMs = 30000 }) {
  const list = (titles ?? []).filter((t) => typeof t === "string" && t.trim()).slice(0, 40);
  if (!list.length) return { ok: true, items: [] };
  if (!token) return { ok: false, error: "no token" };

  let res;
  try {
    res = await fetchImpl(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(list) },
        ],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    return { ok: false, error: err?.name === "TimeoutError" ? "timeout" : (err?.message ?? String(err)) };
  }

  if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };

  let data;
  try {
    data = await res.json();
  } catch {
    return { ok: false, error: "response was not JSON" };
  }
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") return { ok: false, error: "unexpected model response shape" };

  const parsed = extractJson(content);
  if (!parsed || !Array.isArray(parsed.items)) return { ok: false, error: "model did not return the agreed JSON" };

  const input = new Set(list.map((t) => t.trim().toLowerCase()));
  const items = [];
  for (const item of parsed.items) {
    if (typeof item?.title !== "string") continue;
    if (!input.has(item.title.trim().toLowerCase())) continue;
    const category = CATEGORIES.includes(item.category) ? item.category : "other";
    const tags = Array.isArray(item.tags)
      ? item.tags.filter((t) => typeof t === "string" && t.trim()).map((t) => t.trim().toLowerCase()).slice(0, 5)
      : [];
    items.push({ title: item.title.trim(), category, tags });
  }
  if (!items.length) return { ok: false, error: "no valid items in model response" };
  return { ok: true, items };
}

/** Tolerates ```json fences and leading prose; returns null when nothing parses. */
export function extractJson(text) {
  const trimmed = String(text ?? "").trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}
