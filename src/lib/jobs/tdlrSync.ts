import { prisma } from "@/lib/db";
import { getActor } from "@/lib/actor";
import { REGION } from "@/lib/config/region";
import { PROJECT_CONFIG, TDLR_STATUS_CLOSED } from "@/lib/config/projects";
import { statusCodeFromLabel, TDLR_STATUS_LABELS, TDLR_WORK_TYPE_CODES, workTypeFromCode, workTypeFromLabel } from "@/lib/providers/tdlr";
import type { ProjectDetail, ProjectSummary } from "@/lib/providers/types";
import { scoreProjectFields } from "@/lib/scoring/projectScoring";
import { timingWindowFor } from "@/lib/scoring/timingWindow";
import { checkPause, JobPausedError, type JobDeps } from "./shared";
import { readSync, SYNC_KEYS, writeSync, type SyncCursor } from "./syncStatus";
import type { Prisma } from "@prisma/client";

export type TdlrSyncDeps = JobDeps & { now?: () => Date };

const PAGE = 100;
const DAY = 86_400_000;

function projectData(s: ProjectSummary, d: ProjectDetail | null, now: Date): Prisma.ProjectUncheckedCreateInput {
  const workType = workTypeFromCode(s.workTypeCode) ?? workTypeFromLabel(d?.workTypeLabel);
  const startDate = d?.startDate ?? s.startDate;
  const completionDate = d?.completionDate ?? s.completionDate;
  const estimatedCost = d?.estimatedCost ?? s.estimatedCost;
  const scoring = scoreProjectFields(
    {
      projectName: d?.projectName ?? s.projectName,
      facilityName: d?.facilityName ?? s.facilityName,
      estimatedCost,
      squareFootage: d?.squareFootage ?? null,
      tenantFunded: d?.tenantFunded ?? null,
      workType,
      startDate,
      completionDate,
      statusCode: s.statusCode,
    },
    now,
  );
  return {
    tdlrProjectId: s.tdlrProjectId,
    projectNumber: s.projectNumber,
    projectName: d?.projectName ?? s.projectName,
    facilityName: d?.facilityName ?? s.facilityName,
    locationAddress: d?.locationAddress ?? null,
    city: d?.city ?? null,
    state: d?.state ?? null,
    zip: d?.zip ?? null,
    county: d?.county ?? null,
    statusCode: s.statusCode,
    statusLabel: d?.statusLabel ?? TDLR_STATUS_LABELS[s.statusCode] ?? null,
    workType,
    estimatedCost,
    squareFootage: d?.squareFootage ?? null,
    tenantFunded: d?.tenantFunded ?? null,
    fundsType: d?.fundsType ?? null,
    scopeOfWork: d?.scopeOfWork ?? null,
    startDate,
    completionDate,
    registrationDate: d?.registrationDate ?? s.registeredAt,
    ownerName: d?.ownerName ?? null,
    ownerAddress: d?.ownerAddress ?? null,
    ownerPhone: d?.ownerPhone ?? null,
    contactName: d?.contactName ?? null,
    tenantName: d?.tenantName ?? null,
    designFirmName: d?.designFirmName ?? null,
    rasName: d?.rasName ?? null,
    rasPhone: d?.rasPhone ?? null,
    smbFitScore: scoring.smbFitScore,
    smbFitReasons: scoring.smbFitReasons as unknown as Prisma.InputJsonValue,
    exclusion: scoring.exclusion,
    exclusionReasons: scoring.exclusionReasons,
    timingWindow: scoring.timingWindow,
    detailFetchedAt: d ? now : null,
    lastCheckedAt: now,
    parseError: d ? null : "detail page unavailable",
  };
}

export async function runTdlrSync(deps: TdlrSyncDeps) {
  const log = deps.log ?? (() => {});
  const now = deps.now ? deps.now() : new Date();
  const { id: ownerId } = await getActor();
  const counts = { scanned: 0, skippedStale: 0, created: 0, updated: 0, refreshed: 0, retimed: 0 };
  const state = await readSync(SYNC_KEYS.tdlr);
  const registeredFrom =
    state.lastSuccessfulAt ??
    (() => {
      const from = new Date(now);
      from.setUTCMonth(from.getUTCMonth() - PROJECT_CONFIG.backfillMonths);
      return from;
    })();
  const registeredTo = now;
  // TDLR filters RegistrationDateBegin/End by its own local calendar date,
  // while we store and compare registeredFrom in UTC. Widen the list window
  // by one day so a registration that TDLR considers "today" isn't missed
  // when our UTC cutoff falls a few hours earlier. This is free: rows already
  // detailed from the prior run are skipped via the `existing?.detailFetchedAt`
  // check below, so re-scanning the overlap day does no extra work.
  const listFrom = new Date(registeredFrom.getTime() - DAY);
  const staleBefore = new Date(now.getTime() - PROJECT_CONFIG.staleAfterDays * DAY);
  const cursor = (c: Partial<SyncCursor>) => writeSync(SYNC_KEYS.tdlr, { status: "running", startedAt: now.toISOString(), counts, ...c });

  try {
    await cursor({ message: "Listing registrations" });
    let start = 0;
    let total = Infinity;
    while (start < total) {
      await checkPause(deps);
      const page = await deps.providers.registry.listProjects({ registeredFrom: listFrom, registeredTo, start, length: PAGE });
      total = page.total;
      if (page.items.length === 0) {
        // total === 0 legitimately means nothing to scan; total > 0 with an
        // empty page means the registry returned short, which would silently
        // advance lastSuccessfulAt past unscanned registrations if allowed
        // to fall through to the success path. Fail loudly instead so
        // pg-boss retries and lastSuccessfulAt is left untouched.
        if (start < total) {
          throw new Error(`TDLR returned an empty page at offset ${start} of ${total}`);
        }
        break;
      }
      for (const s of page.items) {
        await checkPause(deps);
        counts.scanned++;
        if (s.completionDate && s.completionDate < staleBefore) {
          counts.skippedStale++;
          continue;
        }
        const existing = await prisma.project.findUnique({ where: { ownerId_projectNumber: { ownerId, projectNumber: s.projectNumber } } });
        if (existing?.detailFetchedAt) continue;
        await cursor({ message: `Fetching ${s.projectNumber}`, current: counts.scanned, total });
        const detail = await deps.providers.registry.getProjectDetail(s.projectNumber);
        const data = projectData(s, detail, now);
        if (existing) {
          // projectData builds a create-shaped object (all scalar fields, no
          // relation connect/disconnect wrappers), which is structurally
          // compatible with the update-input shape but not nominally
          // assignable to it, hence the cast.
          await prisma.project.update({ where: { id: existing.id }, data: data as unknown as Prisma.ProjectUncheckedUpdateInput });
          counts.updated++;
        } else {
          await prisma.project.create({ data: { ...data, ownerId } });
          counts.created++;
        }
      }
      start += page.items.length;
    }

    // Refresh open, unlinked, non-excluded projects not checked recently: dates and status
    // move. Closed and already-stale projects are excluded since they won't change further,
    // and the batch is capped + ordered oldest-first so one run can't grow unbounded as the
    // backlog accumulates.
    const recheckBefore = new Date(now.getTime() - PROJECT_CONFIG.recheckAfterDays * DAY);
    const stale = await prisma.project.findMany({
      where: {
        ownerId,
        businessId: null,
        exclusion: "none",
        lastCheckedAt: { lt: recheckBefore },
        statusCode: { not: TDLR_STATUS_CLOSED },
        OR: [{ timingWindow: null }, { timingWindow: { not: "stale" } }],
      },
      orderBy: { lastCheckedAt: "asc" },
      take: PROJECT_CONFIG.refreshBatchSize,
      select: { id: true, projectNumber: true, tdlrProjectId: true, statusCode: true, registrationDate: true, workType: true },
    });
    for (const p of stale) {
      await checkPause(deps);
      await cursor({ message: `Refreshing ${p.projectNumber}` });
      const detail = await deps.providers.registry.getProjectDetail(p.projectNumber);
      if (!detail) {
        await prisma.project.update({ where: { id: p.id }, data: { lastCheckedAt: now, parseError: "detail page unavailable" } });
        continue;
      }
      const summary: ProjectSummary = {
        tdlrProjectId: p.tdlrProjectId ?? "",
        projectNumber: p.projectNumber,
        projectName: detail.projectName ?? "",
        facilityName: detail.facilityName,
        registeredAt: p.registrationDate ?? now,
        statusCode: statusCodeFromLabel(detail.statusLabel) ?? p.statusCode ?? 0,
        cityCode: REGION.tdlrCityCode,
        countyCode: 0,
        workTypeCode: p.workType ? TDLR_WORK_TYPE_CODES[p.workType] : 0,
        estimatedCost: detail.estimatedCost,
        startDate: detail.startDate,
        completionDate: detail.completionDate,
      };
      // projectData builds a create-shaped object (all scalar fields, no
      // relation connect/disconnect wrappers), which is structurally
      // compatible with the update-input shape but not nominally assignable
      // to it, hence the cast.
      await prisma.project.update({
        where: { id: p.id },
        data: projectData(summary, detail, now) as unknown as Prisma.ProjectUncheckedUpdateInput,
      });
      counts.refreshed++;
    }

    // Recompute timingWindow for every project of this owner: it's a pure function of
    // (startDate, completionDate, statusCode, now), so a project can cross a window
    // boundary (e.g. opening_soon -> under_construction) purely from the passage of time,
    // without any detail refetch. This is a local computation over already-stored fields,
    // not a network call, so it's cheap to run over the whole set each sync.
    await checkPause(deps);
    const allProjects = await prisma.project.findMany({
      where: { ownerId },
      select: { id: true, startDate: true, completionDate: true, statusCode: true, timingWindow: true },
    });
    for (const p of allProjects) {
      const timingWindow = timingWindowFor({ startDate: p.startDate, completionDate: p.completionDate, statusCode: p.statusCode }, now);
      if (timingWindow !== p.timingWindow) {
        await prisma.project.update({ where: { id: p.id }, data: { timingWindow } });
        counts.retimed++;
      }
    }

    await writeSync(SYNC_KEYS.tdlr, { status: "idle", finishedAt: new Date().toISOString(), counts, error: null }, registeredTo);
    log(`tdlr sync: ${JSON.stringify(counts)}`);
    return counts;
  } catch (e) {
    if (e instanceof JobPausedError) {
      await writeSync(SYNC_KEYS.tdlr, { status: "paused", message: "Paused", counts });
      return counts;
    }
    const message = (e as Error).message ?? String(e);
    await writeSync(SYNC_KEYS.tdlr, { status: "failed", error: message, counts });
    throw e;
  }
}
