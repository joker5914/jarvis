import { PgBoss } from "pg-boss";
import { QUEUES, type ZipSearchJobData } from "@/lib/jobs/queues";
import { runZipSearch } from "@/lib/jobs/zipSearch";
import { getProviders } from "@/lib/providers";

async function main() {
  const boss = new PgBoss({ connectionString: process.env.DATABASE_URL! });
  boss.on("error", (e) => console.error("[pg-boss]", e));
  await boss.start();
  for (const q of Object.values(QUEUES)) await boss.createQueue(q);

  await boss.work<ZipSearchJobData>(QUEUES.zipSearch, { batchSize: 1 }, async ([job]) => {
    console.log(`[zip-search] start ${job.data.searchId}`);
    await runZipSearch(job.data.searchId, { providers: getProviders(), log: console.log });
    console.log(`[zip-search] done ${job.data.searchId}`);
  });

  console.log(`worker ready (PROVIDER_MODE=${process.env.PROVIDER_MODE ?? "fake"})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
