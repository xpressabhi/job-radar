// SmartRecruiters Posting API adapter — public, documented. Offset/limit pagination
// (page size 100); `totalFound: 0` is a valid empty tenant, not an error.
import { isoDate } from "../lib/dates.mjs";
import { stripHtml } from "../lib/html.mjs";

const PAGE = (id, offset, limit) =>
  `https://api.smartrecruiters.com/v1/companies/${id}/postings?limit=${limit}&offset=${offset}`;
const DETAIL = (id, postingId) => `https://api.smartrecruiters.com/v1/companies/${id}/postings/${postingId}`;
const PAGE_SIZE = 100;

export const ats = "sr";

export function toPosting(company, item) {
  const loc = item?.location ?? {};
  const flat = [loc.city, loc.region, loc.country].filter(Boolean).join(", ");
  const locations = [loc.fullLocation || flat].filter(Boolean);
  return {
    source: "sr",
    company: company.name,
    companySlug: company.slug,
    jobId: String(item?.id ?? ""),
    title: String(item?.name ?? "").trim(),
    locationRaw: locations[0] ?? "",
    locations,
    country: typeof loc.country === "string" ? loc.country.toUpperCase() : null,
    mode: loc.remote ? "remote" : loc.hybrid ? "hybrid" : null,
    url: item?.id ? `https://jobs.smartrecruiters.com/${company.slug}/${item.id}` : "",
    postedAt: isoDate(item?.releasedDate),
    description: null,
    employmentType: item?.typeOfEmployment?.label ?? null,
  };
}

export async function listBoard({ fetcher, company }) {
  const postings = [];
  let offset = 0;
  let total = 0;
  for (;;) {
    const res = await fetcher.getJson(PAGE(company.slug, offset, PAGE_SIZE));
    if (!res.ok) return { ok: false, status: res.status, error: res.error };
    const content = res.data?.content;
    if (!Array.isArray(content)) return { ok: false, status: res.status, error: "unexpected payload shape" };
    total = Number.isFinite(res.data?.totalFound) ? res.data.totalFound : content.length;
    postings.push(...content.map((item) => toPosting(company, item)));
    offset += content.length;
    if (content.length === 0 || content.length < PAGE_SIZE || offset >= total || offset > 10000) break;
  }
  return { ok: true, total, postings };
}

export async function fetchJobDetail({ fetcher, company, jobId }) {
  const res = await fetcher.getJson(DETAIL(company.slug, jobId));
  if (!res.ok) return { ok: false, status: res.status, error: res.error };
  const sections = res.data?.jobAd?.sections ?? {};
  const description = ["companyDescription", "jobDescription", "qualifications", "additionalInformation"]
    .map((key) => stripHtml(sections[key]))
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 4000);
  return {
    ok: true,
    description: description || null,
    postedAt: null,
    applyUrl: res.data?.applyUrl ?? null,
  };
}
