import { getBoss } from "./boss";
import { QUEUES, type TdlrSyncJobData, type ZipSearchJobData } from "./queues";
import { runZipSearch } from "./zipSearch";
import { runTdlrSync } from "./tdlrSync";
import { getProviders } from "@/lib/providers";

export const MANUAL_PRIORITY = 10;
export const SCANNER_PRIORITY = 1;

/**
 * JOB_MODE=queue (default): hand the job to the pg-boss worker.
 * JOB_MODE=inline: run it inside this process (e2e tests and single-process demos).
 */
export async function enqueueZipSearch(searchId: string, opts: { priority?: number } = {}): Promise<void> {
  if (process.env.JOB_MODE === "inline") {
    void runZipSearch(searchId, { providers: getProviders(), log: console.log }).catch((e) =>
      console.error("[inline zip-search]", e),
    );
    return;
  }
  const boss = await getBoss();
  const data: ZipSearchJobData = { searchId };
  await boss.send(QUEUES.zipSearch, data, {
    retryLimit: 3,
    retryDelay: 60,
    priority: opts.priority ?? MANUAL_PRIORITY,
    singletonKey: searchId,
  });
}

export async function enqueueTdlrSync(): Promise<void> {
  if (process.env.JOB_MODE === "inline") {
    void runTdlrSync({ providers: getProviders(), log: console.log }).catch((e) => console.error("[inline tdlr-sync]", e));
    return;
  }
  const boss = await getBoss();
  const data: TdlrSyncJobData = {};
  await boss.send(QUEUES.tdlrSync, data, { retryLimit: 3, retryDelay: 60, priority: MANUAL_PRIORITY, singletonKey: "tdlr" });
}
