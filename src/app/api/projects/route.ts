import { getActor } from "@/lib/actor";
import { handle, json } from "@/lib/api";
import { loadConfig } from "@/lib/config/runtime";
import { parseProjectFilters } from "@/lib/projects/filters";
import { listProjects } from "@/lib/projects/queries";
import { isSyncRunning, readSync, SYNC_KEYS } from "@/lib/jobs/syncStatus";

export const GET = handle(async (req) => {
  const actor = await getActor();
  const f = parseProjectFilters(req.nextUrl.searchParams);
  const cfg = await loadConfig(actor.id);
  const [{ items, total }, sync, batch] = await Promise.all([
    listProjects(f, actor.id, cfg.projects),
    readSync(SYNC_KEYS.tdlr),
    readSync(SYNC_KEYS.promoteBatch),
  ]);
  const syncRunning = isSyncRunning(sync.cursor) || isSyncRunning(batch.cursor);
  return json({ items, total, page: f.page, pageSize: f.pageSize, syncRunning });
});
