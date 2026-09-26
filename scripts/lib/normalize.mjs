// Cleaning helpers: titles, URLs, dedupe keys. Pure functions, fully testable.

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu;
const MODE_MARKERS = /\s*[([\-–|]\s*(remote|hybrid|on[- ]?site|wfh)\s*[)\]]?\s*/gi;
const REQ_IDS = [
  /\s*[([{]\s*(?:req(?:uisition)?|job|jr|r)[\s#.:-]*\d{3,}\s*[)\]}]/gi,
  /\s*\b(?:req(?:uisition)?|jr)[\s#.:-]?\d{4,}\b/gi,
];
const TRAILING_CITY =
  /\s*[\-–|,]\s*(bengaluru|bangalore|hyderabad|pune|mumbai|delhi|new delhi|gurugram|gurgaon|noida|chennai|kolkata|ahmedabad|jaipur|kochi|cochin|indore|coimbatore|thiruvananthapuram|trivandrum|india)\s*$/i;

export function cleanTitle(raw) {
  let t = String(raw ?? "");
  t = t.replace(EMOJI, " ");
  t = t.replace(MODE_MARKERS, " ");
  for (const re of REQ_IDS) t = t.replace(re, " ");
  t = t.replace(TRAILING_CITY, "");
  t = t.replace(/\s*[([{]\s*[)\]}]/g, " "); // empty brackets left behind
  t = t.replace(/\s{2,}/g, " ");
  t = t.replace(/^[\s\-–|,]+|[\s\-–|,]+$/g, "");
  return t.trim();
}

const TRACKING_PARAMS = [/^utm_/i, /^gh_src$/i, /^source$/i, /^ref$/i, /^trk/i, /^tracking/i, /^(mc_cid|mc_eid|fbclid|gclid)$/i];

export function canonicalUrl(raw) {
  if (typeof raw !== "string" || !raw) return "";
  let url;
  try {
    url = new URL(raw);
  } catch {
    return raw.trim();
  }
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.some((re) => re.test(key))) url.searchParams.delete(key);
  }
  url.hash = "";
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.toString();
}

export function dedupeKey(posting) {
  return `${posting.source}:${posting.companySlug}:${posting.jobId}`;
}

export function nearDupeKey(posting) {
  const city = (posting.location?.cities?.[0] ?? posting.locationRaw ?? "").toLowerCase();
  return `${posting.companySlug}|${cleanTitle(posting.title).toLowerCase()}|${city}`;
}
