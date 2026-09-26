import { isoDate } from "../lib/dates.mjs";
import { stripHtml } from "../lib/html.mjs";

// Greenhouse Job Board API adapter — public, no auth, documented.
// List carries no descriptions; descriptions, first_published, and pay transparency live on
// the single-job endpoint, fetched only for postings that passed the crawl filters (T6).
const LIST = (slug) => `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`;
const DETAIL = (slug, id) =>
  `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs/${id}?content=true&pay_transparency=true`;

export const ats = "gh";

/** Adapter output shape (consumed by normalize/filters in T6, store merge in T7). */
export function toPosting(company, job) {
  const location = job?.location?.name ?? "";
  return {
    source: "gh",
    company: company.name,
    companySlug: company.slug,
    jobId: String(job?.id ?? ""),
    title: String(job?.title ?? "").trim(),
    locationRaw: location,
    locations: location ? [location] : [],
    mode: null, // not exposed by the list endpoint
    url: job?.absolute_url ?? "",
    postedAt: null, // first_published requires the detail call
    description: null,
    payInputRanges: null,
  };
}

export async function listBoard({ fetcher, company }) {
  const res = await fetcher.getJson(LIST(company.slug));
  if (!res.ok) return { ok: false, status: res.status, error: res.error };
  const jobs = res.data?.jobs;
  if (!Array.isArray(jobs)) return { ok: false, status: res.status, error: "unexpected payload shape" };
  return {
    ok: true,
    total: res.data?.meta?.total ?? jobs.length,
    postings: jobs.map((job) => toPosting(company, job)),
  };
}

export async function fetchJobDetail({ fetcher, company, jobId }) {
  const res = await fetcher.getJson(DETAIL(company.slug, jobId));
  if (!res.ok) return { ok: false, status: res.status, error: res.error };
  const job = res.data;
  if (!job || typeof job !== "object") {
    return { ok: false, status: res.status, error: "unexpected payload shape" };
  }
  const ranges = Array.isArray(job.pay_input_ranges) && job.pay_input_ranges.length ? job.pay_input_ranges : null;
  return {
    ok: true,
    description: stripHtml(job.content).slice(0, 4000),
    postedAt: isoDate(job.first_published),
    payInputRanges: ranges,
  };
}
