// HTTP client for ATS boards: honest user agent, timeout, polite pacing, one retry with backoff.
// Returns result objects instead of throwing, so adapters can fail soft per company.
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createFetcher({
  userAgent = "job-radar/0.1",
  timeoutMs = 20000,
  retries = 1,
  delayMs = 1000,
  fetchImpl = globalThis.fetch,
  sleepImpl = defaultSleep,
} = {}) {
  let requestCount = 0;

  async function once(url) {
    const res = await fetchImpl(url, {
      headers: { "User-Agent": userAgent, Accept: "application/json" },
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let data = null;
    let parseError = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        parseError = "response was not JSON";
      }
    } else if (res.ok) {
      parseError = "empty response";
    }
    return { status: res.status, ok: res.ok, data, parseError };
  }

  return {
    get requestCount() {
      return requestCount;
    },
    async getJson(url) {
      let lastStatus = 0;
      let lastError = "request failed";
      for (let attempt = 0; attempt <= retries; attempt++) {
        if (requestCount > 0) await sleepImpl(delayMs);
        if (attempt > 0) await sleepImpl(Math.min(2000, 500 * 2 ** (attempt - 1)));
        requestCount++;
        try {
          const r = await once(url);
          lastStatus = r.status;
          if (r.parseError) {
            lastError = r.parseError;
            continue;
          }
          if (r.ok) return { ok: true, status: r.status, data: r.data };
          if (r.status >= 500 || r.status === 429) {
            lastError = `HTTP ${r.status}`;
            continue;
          }
          return { ok: false, status: r.status, error: `HTTP ${r.status}` };
        } catch (err) {
          lastError = err?.name === "TimeoutError" ? "timeout" : (err?.message ?? String(err));
        }
      }
      return { ok: false, status: lastStatus, error: lastError };
    },
  };
}
