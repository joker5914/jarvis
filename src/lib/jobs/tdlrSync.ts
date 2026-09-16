import { prisma } from "@/lib/db";
import { getActor } from "@/lib/actor";
import { PROJECT_CONFIG } from "@/lib/config/projects";
import { TDLR_STATUS_LABELS, workTypeFromCode, workTypeFromLabel } from "@/lib/providers/tdlr";
import type { ProjectDetail, ProjectSummary, Providers } from "@/lib/providers/types";
import { scoreProjectFields } from "@/lib/scoring/projectScoring";
import { JobPausedError } from "./zipSearch";
import { readSync, SYNC_KEYS, writeSync, type SyncCursor } from "./syncStatus";
import type { Prisma } from "@prisma/client";

export type TdlrSyncDeps = {
  providers: Providers;
  shouldPause?: () => Promise<boolean>;
  signal?: AbortSignal;
  log?: (msg: string) => void;
  now?: () => Date;
};

const PAGE = 100;
const DAY = 86_400_000;

async function checkPause(deps: TdlrSyncDeps) {
  if (deps.signal?.aborted) throw new JobPausedError();
  if (deps.shouldPause && (await deps.shouldPause())) throw new JobPausedError();
}

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
  const counts = { scanned: 0, skippedStale: 0, created: 0, updated: 0, refreshed: 0 };
  const state = await readSync(SYNC_KEYS.tdlr);
  const registeredFrom =
    state.lastSuccessfulAt ??
    (() => {
      const from = new Date(now);
      from.setUTCMonth(from.getUTCMonth() - PROJECT_CONFIG.backfillMonths);
      return from;
    })();
  const registeredTo = now;
  const staleBefore = new Date(now.getTime() - PROJECT_CONFIG.staleAfterDays * DAY);
  const cursor = (c: Partial<SyncCursor>) => writeSync(SYNC_KEYS.tdlr, { status: "running", startedAt: now.toISOString(), counts, ...c });

  try {
    await cursor({ message: "Listing registrations" });
    let start = 0;
    let total = Infinity;
    while (start < total) {
      await checkPause(deps);
      const page = await deps.providers.registry.listProjects({ registeredFrom, registeredTo, start, length: PAGE });
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

    // Refresh open, unlinked, non-excluded projects not checked recently: dates and status move.
    const recheckBefore = new Date(now.getTime() - PROJECT_CONFIG.recheckAfterDays * DAY);
    const stale = await prisma.project.findMany({
      where: { ownerId, businessId: null, exclusion: "none", lastCheckedAt: { lt: recheckBefore } },
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
        statusCode: p.statusCode ?? 0,
        cityCode: 785,
        countyCode: 0,
        workTypeCode: Object.entries({ new_construction: 9001, renovation: 9002, addition: 9003, historic: 9004, row: 9005 }).find(([k]) => k === p.workType)?.[1] ?? 0,
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
