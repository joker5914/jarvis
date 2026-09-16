import { handle, json } from "@/lib/api";
import { enqueueTdlrSync } from "@/lib/jobs/enqueue";
import { isSyncRunning, readSync, SYNC_KEYS } from "@/lib/jobs/syncStatus";

export const GET = handle(async () => {
  const [tdlr, batch] = await Promise.all([readSync(SYNC_KEYS.tdlr), readSync(SYNC_KEYS.promoteBatch)]);
  return json({ lastSuccessfulAt: tdlr.lastSuccessfulAt, cursor: tdlr.cursor, batch });
});

export const POST = handle(async () => {
  const { cursor } = await readSync(SYNC_KEYS.tdlr);
  if (isSyncRunning(cursor)) return json({ queued: false, reason: "already running" }, 409);
  await enqueueTdlrSync();
  return json({ queued: true }, 202);
});
