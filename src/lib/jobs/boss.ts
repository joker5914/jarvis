import { PgBoss } from "pg-boss";
import { QUEUES } from "./queues";

let bossPromise: Promise<PgBoss> | null = null;

export function getBoss(): Promise<PgBoss> {
  if (!bossPromise) {
    bossPromise = (async () => {
      const boss = new PgBoss({ connectionString: process.env.DATABASE_URL! });
      boss.on("error", (e) => console.error("[pg-boss]", e));
      await boss.start();
      for (const q of Object.values(QUEUES)) await boss.createQueue(q);
      return boss;
    })();
  }
  return bossPromise;
}
