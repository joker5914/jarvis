import { PgBoss } from "pg-boss";
import { ensureQueue, QUEUES, QUEUE_OPTIONS } from "./queues";

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
      for (const q of Object.values(QUEUES)) await ensureQueue(boss, q, QUEUE_OPTIONS[q]);
      return boss;
    })();
  }
  return globalForBoss.boss;
}
