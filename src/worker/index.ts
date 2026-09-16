import { PgBoss } from "pg-boss";
import {
  ensureQueue,
  QUEUES,
  QUEUE_OPTIONS,
  type EnrichJobData,
  type PromoteBatchJobData,
  type PromoteJobData,
  type ScannerTickJobData,
  type TdlrSyncJobData,
  type WebsiteRecheckJobData,
  type ZipSearchJobData,
} from "@/lib/jobs/queues";
import { runZipSearch } from "@/lib/jobs/zipSearch";
import { runTdlrSync } from "@/lib/jobs/tdlrSync";
import { runPromoteBusiness, runPromoteHighFit } from "@/lib/jobs/promote";
import { runWebsiteRecheck } from "@/lib/jobs/websiteRecheck";
import { runEnrich } from "@/lib/jobs/enrich";
import { JobPausedError, scannerPauseCheck } from "@/lib/jobs/shared";
import { runScannerTick } from "@/lib/scanner/tick";
import { REGION } from "@/lib/config/region";
import { SCANNER_CONFIG } from "@/lib/config/scanner";
import { prisma } from "@/lib/db";
import { getProviders } from "@/lib/providers";
import { getActor } from "@/lib/actor";
import { BudgetExhaustedError } from "@/lib/providers/budget";
import { ProviderNotConfiguredError, ProviderDisabledError } from "@/lib/providers/errors";

async function main() {
  const boss = new PgBoss({ connectionString: process.env.DATABASE_URL! });
  boss.on("error", (e) => console.error("[pg-boss]", e));
  await boss.start();
  for (const q of Object.values(QUEUES)) await ensureQueue(boss, q, QUEUE_OPTIONS[q]);

  // localConcurrency: 2 so a manual search (MANUAL_PRIORITY, fetched first) never has to wait
  // behind an in-flight scanner-origin search (SCANNER_PRIORITY) — the scanner still
  // self-limits to one job via ScanSchedule.maxConcurrentJobs, and the queue's "stately"
  // policy (see queues.ts) still allows only one active job per searchId.
  await boss.work<ZipSearchJobData>(QUEUES.zipSearch, { batchSize: 1, localConcurrency: 2 }, async ([job]) => {
    const { searchId, origin } = job.data;
    console.log(`[zip-search] start ${searchId} (${origin ?? "manual"})`);
    const search = await prisma.search.findUnique({ where: { id: searchId }, select: { ownerId: true } });
    const shouldPause = origin === "scanner" && search ? scannerPauseCheck(search.ownerId) : undefined;
    await runZipSearch(searchId, { providers: getProviders(), log: console.log, signal: job.signal, shouldPause });
    console.log(`[zip-search] done ${searchId}`);
  });

  await boss.work<TdlrSyncJobData>(QUEUES.tdlrSync, { batchSize: 1 }, async ([job]) => {
    const { origin } = job.data;
    console.log(`[tdlr-sync] start (${origin ?? "manual"})`);
    const shouldPause = origin === "scanner" ? scannerPauseCheck((await getActor()).id) : undefined;
    await runTdlrSync({ providers: getProviders(), log: console.log, signal: job.signal, shouldPause });
    console.log(`[tdlr-sync] done`);
  });
  // Nightly at 03:00 in the configured region; pg-boss dedupes the schedule by queue name.
  // singletonKey matches the manual "Sync now" key so a cron fire can never
  // queue a second run behind one already in flight.
  await boss.schedule(QUEUES.tdlrSync, "0 3 * * *", {}, { tz: REGION.timezone, singletonKey: "tdlr" });

  await boss.work<PromoteJobData>(QUEUES.promote, { batchSize: 1 }, async ([job]) => {
    console.log(`[promote] start ${job.data.businessId}`);
    await runPromoteBusiness(job.data.businessId, job.data.ownerId, { providers: getProviders(), log: console.log, signal: job.signal });
    console.log(`[promote] done ${job.data.businessId}`);
  });

  await boss.work<PromoteBatchJobData>(QUEUES.promoteBatch, { batchSize: 1 }, async ([job]) => {
    console.log(`[promote-batch] start`);
    const r = await runPromoteHighFit({ providers: getProviders(), log: console.log, signal: job.signal });
    console.log(`[promote-batch] done ${JSON.stringify(r)}`);
  });

  await boss.work<WebsiteRecheckJobData>(QUEUES.websiteRecheck, { batchSize: 1 }, async ([job]) => {
    console.log(`[website-recheck] start ${job.data.businessIds.length}`);
    try {
      await runWebsiteRecheck(job.data.businessIds, job.data.ownerId, { providers: getProviders(), log: console.log, signal: job.signal, shouldPause: scannerPauseCheck(job.data.ownerId) });
      console.log(`[website-recheck] done`);
    } catch (e) {
      // runWebsiteRecheck has no outer JobPausedError handling of its own (see its doc
      // comment) — unlike zip-search/tdlr-sync/promote-batch, which each swallow their own
      // pause and record it on a stateful row. Swallow it here instead, consistent with those:
      // a pause is not a job failure, so it shouldn't retry or surface as a pg-boss failure.
      if (e instanceof JobPausedError) {
        console.log(`[website-recheck] paused`);
        return;
      }
      throw e;
    }
  });

  await boss.work<EnrichJobData>(QUEUES.enrich, { batchSize: 1 }, async ([job]) => {
    const { businessId, ownerId, force } = job.data;
    console.log(`[enrich] start ${businessId}`);
    try {
      await runEnrich(businessId, ownerId, { providers: getProviders(), log: console.log, signal: job.signal }, { force });
      console.log(`[enrich] done ${businessId}`);
    } catch (e) {
      // These are unrecoverable by retrying: runEnrich already recorded exactly one activity
      // row explaining why. Log and return (pg-boss records success) rather than rethrow, so
      // the job isn't retried into a duplicate activity row. Any other error still propagates
      // to pg-boss's retry policy.
      if (e instanceof BudgetExhaustedError || e instanceof ProviderNotConfiguredError || e instanceof ProviderDisabledError) {
        console.log(`[enrich] skipped ${businessId}: ${e.message}`);
        return;
      }
      throw e;
    }
  });

  await boss.work<ScannerTickJobData>(QUEUES.scannerTick, { batchSize: 1 }, async () => {
    const r = await runScannerTick();
    console.log(`[scanner-tick] ${r.status}${r.work ? ` ${r.work.kind}` : ""}`);
  });
  // Every SCANNER_CONFIG.tickMinutes; the tick itself decides whether there's anything to do.
  // singletonKey matches enqueueScannerTick's manual key so a cron fire can never
  // queue a second tick behind one already in flight.
  await boss.schedule(QUEUES.scannerTick, `*/${SCANNER_CONFIG.tickMinutes} * * * *`, {}, { tz: REGION.timezone, singletonKey: "scanner-tick" });

  console.log(`worker ready (PROVIDER_MODE=${process.env.PROVIDER_MODE ?? "fake"})`);

  for (const sig of ["SIGTERM", "SIGINT"] as const) {
    process.on(sig, async () => {
      console.log(`[worker] ${sig}, stopping`);
      await boss.stop({ graceful: true, timeout: 30_000 });
      process.exit(0);
    });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
