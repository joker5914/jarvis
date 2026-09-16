import { PgBoss } from "pg-boss";
import { QUEUES, type TdlrSyncJobData, type ZipSearchJobData } from "@/lib/jobs/queues";
import { runZipSearch } from "@/lib/jobs/zipSearch";
import { runTdlrSync } from "@/lib/jobs/tdlrSync";
import { getProviders } from "@/lib/providers";

// A real-mode zip search can run well past pg-boss's default 900s job
// expiry; keep this in sync with src/lib/jobs/boss.ts.
const EXPIRE_IN_SECONDS = 3600;

async function main() {
  const boss = new PgBoss({ connectionString: process.env.DATABASE_URL! });
  boss.on("error", (e) => console.error("[pg-boss]", e));
  await boss.start();
  for (const q of Object.values(QUEUES)) await boss.createQueue(q, { expireInSeconds: EXPIRE_IN_SECONDS });

  await boss.work<ZipSearchJobData>(QUEUES.zipSearch, { batchSize: 1 }, async ([job]) => {
    console.log(`[zip-search] start ${job.data.searchId}`);
    await runZipSearch(job.data.searchId, { providers: getProviders(), log: console.log, signal: job.signal });
    console.log(`[zip-search] done ${job.data.searchId}`);
  });

  await boss.work<TdlrSyncJobData>(QUEUES.tdlrSync, { batchSize: 1 }, async ([job]) => {
    console.log(`[tdlr-sync] start`);
    await runTdlrSync({ providers: getProviders(), log: console.log, signal: job.signal });
    console.log(`[tdlr-sync] done`);
  });
  // Nightly at 03:00 Central; pg-boss dedupes the schedule by queue name.
  await boss.schedule(QUEUES.tdlrSync, "0 3 * * *", {}, { tz: "America/Chicago" });

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
