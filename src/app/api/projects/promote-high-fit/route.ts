import { handle, json } from "@/lib/api";
import { enqueuePromoteBatch } from "@/lib/jobs/enqueue";
import { readSync, SYNC_KEYS } from "@/lib/jobs/syncStatus";

export const POST = handle(async () => {
  const { cursor } = await readSync(SYNC_KEYS.promoteBatch);
  if (cursor.status === "running") return json({ queued: false, reason: "already running" }, 409);
  await enqueuePromoteBatch();
  return json({ queued: true }, 202);
});
