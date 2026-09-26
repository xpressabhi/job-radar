// Job store: merge crawl results, two-strike archiving, reopen detection, comp evidence, health.
// Pure functions over plain objects; the crawl script owns file IO.
import { nearDupeKey } from "./normalize.mjs";
import { migrateJob } from "./accessors.mjs";
import { migrateLegacyEvidence } from "./money.mjs";

export const emptyStore = () => ({ updated: null, lastRun: null, jobs: [] });

export function mergeResults({ store, results, config, now, archive = true }) {
  const jobs = (store.jobs ?? []).map(migrateJob);
  const byId = new Map(jobs.map((j) => [j.id, j]));
  const activeNear = new Map();
  for (const j of jobs) {
    if (j.status === "active") activeNear.set(nearDupeKey(j), j.id);
  }

  const summary = { seen: 0, new: 0, archived: 0, reopened: 0, duplicates: 0, boardsOk: 0, boardsFailed: 0 };
  const successfullyFetched = new Set();
  const seenIds = new Set();

  for (const result of results) {
    if (!result.ok) {
      summary.boardsFailed++;
      continue;
    }
    summary.boardsOk++;
    // Zero-result boards are treated as suspicious: no miss counting for them.
    // (A board whose jobs were all filtered out still archives normally.)
    const rawCount = result.rawCount ?? result.postings?.length ?? 0;
    if (rawCount === 0) continue;
    successfullyFetched.add(result.companySlug);

    for (const posting of result.postings) {
      const id = posting.dedupeKey;
      const near = nearDupeKey(posting);
      const existing = byId.get(id);

      if (!existing) {
        const twinId = activeNear.get(near);
        if (twinId && twinId !== id) {
          // Same company + title + city already tracked: collapse, newest data wins.
          const twin = byId.get(twinId);
          if (twin) {
            const { dedupeKey: _dk, ...rest } = migrateJob(posting);
            Object.assign(twin, rest, { id: twinId });
            twin.lastSeen = now;
            twin.misses = 0;
          }
          summary.duplicates++;
          seenIds.add(twinId);
          summary.seen++;
          continue;
        }
        const record = {
          ...migrateJob(posting),
          id,
          firstSeen: now,
          lastSeen: now,
          misses: 0,
          status: "active",
          closedAt: null,
          reopenedAt: null,
        };
        jobs.push(record);
        byId.set(id, record);
        activeNear.set(near, id);
        summary.new++;
        seenIds.add(id);
        summary.seen++;
        continue;
      }

      // Existing record — update and reset the miss counter.
      const wasArchived = existing.status === "archived";
      Object.assign(existing, migrateJob(posting), { id });
      existing.lastSeen = now;
      existing.misses = 0;
      if (wasArchived) {
        existing.status = "active";
        existing.reopenedAt = now;
        existing.closedAt = null;
        summary.reopened++;
      }
      activeNear.set(near, id);
      seenIds.add(id);
      summary.seen++;
    }
  }

  // Two-strike archiving: only for companies with a successful, non-empty fetch this run.
  if (archive) {
    for (const job of jobs) {
      if (job.status !== "active") continue;
      if (!successfullyFetched.has(job.companySlug)) continue;
      if (seenIds.has(job.id)) continue;
      job.misses = (job.misses ?? 0) + 1;
      if (job.misses >= (config.archiveMisses ?? 2)) {
        job.status = "archived";
        job.closedAt = now;
        summary.archived++;
      }
    }
  }

  store.jobs = jobs;
  store.updated = now;
  store.lastRun = { at: now, ...summary };
  return { store, summary };
}

/** Append base-pay observations, deduped by url+band so daily runs do not bloat the file. */
export function appendCompEvidence(evidence, postings, now) {
  const migrated = (evidence ?? []).map(migrateLegacyEvidence);
  const seen = new Set(migrated.map((e) => `${e.url}|${e.baseMin}|${e.baseMax}|${e.totalOnly}`));
  const additions = [];
  for (const p of postings) {
    if (!p?.pay?.published) continue;
    const key = `${p.url}|${p.pay.baseMin}|${p.pay.baseMax}|${p.pay.totalOnly}`;
    if (seen.has(key)) continue;
    seen.add(key);
    additions.push({
      company: p.company,
      title: p.title,
      currency: p.pay.currency,
      baseMin: p.pay.baseMin ?? null,
      baseMax: p.pay.baseMax ?? null,
      totalOnly: p.pay.totalOnly ?? false,
      raw: p.pay.raw ?? null,
      observedOn: now,
      url: p.url,
    });
  }
  return { evidence: [...migrated, ...additions], added: additions.length };
}

export function updateHealth(health, results, now) {
  const next = { ...(health ?? {}) };
  for (const r of results) {
    const entry = next[r.companySlug] ?? { lastOk: null, lastFail: null, consecutiveFails: 0, lastError: null };
    if (r.ok) {
      entry.lastOk = now;
      entry.consecutiveFails = 0;
      entry.lastError = null;
    } else {
      entry.lastFail = now;
      entry.consecutiveFails = (entry.consecutiveFails ?? 0) + 1;
      entry.lastError = r.error ?? "unknown error";
    }
    next[r.companySlug] = entry;
  }
  return next;
}

export function runSummaryLine(summary, totalBoards, dateISO) {
  return `crawl: ${dateISO} — +${summary.new} new, ${summary.archived} archived, ${summary.seen} seen, ${summary.boardsOk}/${totalBoards} boards ok`;
}
