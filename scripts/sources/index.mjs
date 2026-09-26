// Adapter registry. One module per ATS; every adapter exports:
//   ats, listBoard({fetcher, company}) -> {ok, total?, postings[], status?, error?}
//   fetchJobDetail({fetcher, company, jobId}) -> {ok, description?, postedAt?, ...}
import * as gh from "./greenhouse.mjs";
import * as lever from "./lever.mjs";
import * as ashby from "./ashby.mjs";
import * as sr from "./smartrecruiters.mjs";
import * as workable from "./workable.mjs";

export const adapters = { gh, lever, ashby, sr, workable };

export function getAdapter(ats) {
  return adapters[ats] ?? null;
}
