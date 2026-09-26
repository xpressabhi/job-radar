// Workable public widget endpoint adapter (community-documented; the official API is
// key-gated). One call returns the whole board, descriptions included.
import { isoDate } from "../lib/dates.mjs";
import { stripHtml } from "../lib/html.mjs";

const LIST = (sub) => `https://apply.workable.com/api/v1/widget/accounts/${sub}?details=true`;

export const ats = "workable";

export function toPosting(company, job) {
  const structured = Array.isArray(job?.locations)
    ? job.locations
        .map((l) => [l?.city, l?.region, l?.country].filter(Boolean).join(", "))
        .filter(Boolean)
    : [];
  const flat = [job?.city, job?.state, job?.country].filter(Boolean).join(", ");
  const locations = structured.length ? structured : flat ? [flat] : [];
  return {
    source: "workable",
    company: company.name,
    companySlug: company.slug,
    jobId: String(job?.shortcode ?? job?.code ?? ""),
    title: String(job?.title ?? "").trim(),
    locationRaw: locations[0] ?? "",
    locations,
    country: typeof job?.country === "string" ? job.country : null,
    mode: job?.telecommuting === true ? "remote" : null,
    url: job?.url ?? job?.application_url ?? "",
    postedAt: isoDate(job?.published_on),
    description: typeof job?.description === "string" ? stripHtml(job.description).slice(0, 4000) : null,
  };
}

export async function listBoard({ fetcher, company }) {
  const res = await fetcher.getJson(LIST(company.slug));
  if (!res.ok) return { ok: false, status: res.status, error: res.error };
  const jobs = res.data?.jobs;
  if (!Array.isArray(jobs)) return { ok: false, status: res.status, error: "unexpected payload shape" };
  return { ok: true, total: jobs.length, postings: jobs.map((job) => toPosting(company, job)) };
}
