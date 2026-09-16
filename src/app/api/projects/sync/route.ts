import { getActor } from "@/lib/actor";
import { handle, json } from "@/lib/api";
import { enqueueTdlrSync } from "@/lib/jobs/enqueue";
import { isSyncRunning, readSync, SYNC_KEYS } from "@/lib/jobs/syncStatus";

export const GET = handle(async () => {
  const [tdlr, batch] = await Promise.all([readSync(SYNC_KEYS.tdlr), readSync(SYNC_KEYS.promoteBatch)]);
  return json({
    lastSuccessfulAt: tdlr.lastSuccessfulAt,
    cursor: tdlr.cursor,
    running: isSyncRunning(tdlr.cursor),
    batch: { ...batch, running: isSyncRunning(batch.cursor) },
  });
});

export const POST = handle(async () => {
  const actor = await getActor();
  const { cursor } = await readSync(SYNC_KEYS.tdlr);
  if (isSyncRunning(cursor)) return json({ queued: false, reason: "already running" }, 409);
  const queued = await enqueueTdlrSync();
  if (!queued) return json({ queued: false, reason: "already queued" }, 409);
  return json({ queued: true, ownerId: actor.id }, 202);
});
