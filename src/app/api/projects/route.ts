import { getActor } from "@/lib/actor";
import { handle, json } from "@/lib/api";
import { parseProjectFilters } from "@/lib/projects/filters";
import { listProjects } from "@/lib/projects/queries";
import { readSync, SYNC_KEYS } from "@/lib/jobs/syncStatus";

export const GET = handle(async (req) => {
  const actor = await getActor();
  const f = parseProjectFilters(req.nextUrl.searchParams);
  const [{ items, total }, sync, batch] = await Promise.all([listProjects(f, actor.id), readSync(SYNC_KEYS.tdlr), readSync(SYNC_KEYS.promoteBatch)]);
  const syncRunning = sync.cursor.status === "running" || batch.cursor.status === "running";
  return json({ items, total, page: f.page, pageSize: f.pageSize, syncRunning });
});
