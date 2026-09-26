// Lever Postings API adapter — public, documented. The list endpoint already carries
// descriptions, so no detail fetch is needed. Politeness: Lever's robots asks Crawl-delay: 1
// (covered by the shared fetch pacing).
import { isoDate } from "../lib/dates.mjs";

const LIST = (slug) => `https://api.lever.co/v0/postings/${slug}?mode=json`;

export const ats = "lever";

const MODE = { remote: "remote", hybrid: "hybrid", onsite: "onsite" };

export function toPosting(company, job) {
  const all = Array.isArray(job?.categories?.allLocations)
    ? job.categories.allLocations.map(String).filter(Boolean)
    : [];
  const locations = all.length ? all : [job?.categories?.location].filter(Boolean).map(String);
  const description = [job?.descriptionPlain, job?.additionalPlain]
    .filter((s) => typeof s === "string" && s)
    .join("\n\n");
  return {
    source: "lever",
    company: company.name,
    companySlug: company.slug,
    jobId: String(job?.id ?? ""),
    title: String(job?.text ?? "").trim(),
    locationRaw: locations[0] ?? "",
    locations,
    country: typeof job?.country === "string" ? job.country : null,
    mode: MODE[String(job?.workplaceType ?? "").toLowerCase()] ?? null,
    url: job?.hostedUrl ?? job?.applyUrl ?? "",
    postedAt: isoDate(job?.createdAt),
    description: description ? description.slice(0, 4000) : null,
    salaryRange: job?.salaryRange ?? null,
  };
}

export async function listBoard({ fetcher, company }) {
  const res = await fetcher.getJson(LIST(company.slug));
  if (!res.ok) return { ok: false, status: res.status, error: res.error };
  const jobs = res.data;
  if (!Array.isArray(jobs)) return { ok: false, status: res.status, error: "unexpected payload shape" };
  return { ok: true, total: jobs.length, postings: jobs.map((job) => toPosting(company, job)) };
}
