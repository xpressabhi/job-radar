// Ashby Posting API adapter — public, documented. The list endpoint carries descriptions
// and (with includeCompensation=true) compensation tiers. `isListed=false` postings are
// unlisted and excluded; `isRemote` can be null in practice, so prefer `workplaceType`.
import { isoDate } from "../lib/dates.mjs";

const LIST = (org) => `https://api.ashbyhq.com/posting-api/job-board/${org}?includeCompensation=true`;

export const ats = "ashby";

const MODE = { onsite: "onsite", remote: "remote", hybrid: "hybrid" };

export function toPosting(company, job) {
  const secondary = Array.isArray(job?.secondaryLocations)
    ? job.secondaryLocations
        .map((s) => (typeof s === "string" ? s : s?.location))
        .filter((s) => typeof s === "string" && s)
    : [];
  const primary = typeof job?.location === "string" && job.location ? [job.location] : [];
  const locations = [...primary, ...secondary];
  return {
    source: "ashby",
    company: company.name,
    companySlug: company.slug,
    jobId: String(job?.id ?? ""),
    title: String(job?.title ?? "").trim(),
    locationRaw: locations[0] ?? "",
    locations,
    country: job?.address?.postalAddress?.addressCountry ?? null,
    mode: MODE[String(job?.workplaceType ?? "").toLowerCase()] ?? null,
    url: job?.jobUrl ?? job?.applyUrl ?? "",
    postedAt: isoDate(job?.publishedAt),
    description: typeof job?.descriptionPlain === "string" ? job.descriptionPlain.slice(0, 4000) : null,
    compensation: job?.compensation ?? null,
  };
}

export async function listBoard({ fetcher, company }) {
  const res = await fetcher.getJson(LIST(company.slug));
  if (!res.ok) return { ok: false, status: res.status, error: res.error };
  const jobs = res.data?.jobs;
  if (!Array.isArray(jobs)) return { ok: false, status: res.status, error: "unexpected payload shape" };
  const listed = jobs.filter((job) => job?.isListed !== false);
  return { ok: true, total: listed.length, postings: listed.map((job) => toPosting(company, job)) };
}
