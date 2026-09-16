import { PgBoss } from "pg-boss";
import { QUEUES } from "./queues";

// A real-mode zip search (discovery + scraping + MX validation across many
// businesses) can run well past pg-boss's default 900s job expiry. Once a job
// expires, pg-boss retries it while the original run may still be in flight,
// so both instances touch the same searchId concurrently. Give the queue
// plenty of headroom instead.
const EXPIRE_IN_SECONDS = 3600;

const globalForBoss = globalThis as unknown as { boss?: Promise<PgBoss> };

export function getBoss(): Promise<PgBoss> {
  if (!globalForBoss.boss) {
    globalForBoss.boss = (async () => {
      // This client only sends jobs; it never starts pg-boss's own maintenance
      // (supervise) or scheduling loops. Caching it on globalThis keeps dev
      // HMR from spinning up a new PgBoss (and new pg pool) on every reload.
      const boss = new PgBoss({ connectionString: process.env.DATABASE_URL!, supervise: false, schedule: false });
      boss.on("error", (e) => console.error("[pg-boss]", e));
      await boss.start();
      for (const q of Object.values(QUEUES)) await boss.createQueue(q, { expireInSeconds: EXPIRE_IN_SECONDS });
      return boss;
    })();
  }
  return globalForBoss.boss;
}
