"use client";

import { useCallback, useEffect, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import type { ProjectRow } from "@/lib/projects/queries";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useLeadFilters } from "@/components/leads/useLeadFilters";
import { ProjectFilters } from "./ProjectFilters";
import { ProjectsTable } from "./ProjectsTable";
import { ProjectDrawer } from "./ProjectDrawer";
import { FindBusinessDialog } from "./FindBusinessDialog";
import { SyncBar } from "./SyncBar";

type ListResponse = { items: ProjectRow[]; total: number; page: number; pageSize: number; syncRunning: boolean };

export function ProjectsView() {
  const { params, set } = useLeadFilters();
  const [data, setData] = useState<ListResponse | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [findId, setFindId] = useState<string | null>(null);
  const [syncActive, setSyncActive] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch(`/api/projects?${params.toString()}`, { cache: "no-store" });
    if (r.ok) setData(await r.json());
  }, [params]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!syncActive && !data?.syncRunning) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [syncActive, data?.syncRunning, load]);

  const page = data?.page ?? 1;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-4">
      <SyncBar onActivity={setSyncActive} />
      <div className="flex flex-col gap-4 md:flex-row">
        <aside className="hidden w-64 shrink-0 md:block">
          <div className="sticky top-20 rounded-lg border bg-white p-4 dark:bg-neutral-900"><ProjectFilters /></div>
        </aside>
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm text-neutral-500" data-testid="projects-count">{data ? `${data.total} project${data.total === 1 ? "" : "s"}` : "Loading…"}</div>
            <Sheet>
              <SheetTrigger render={<Button variant="outline" size="sm" className="md:hidden" />}><SlidersHorizontal className="mr-1 h-4 w-4" />Filters</SheetTrigger>
              <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto p-4">
                <SheetTitle className="mb-3">Filters</SheetTitle>
                <ProjectFilters />
              </SheetContent>
            </Sheet>
          </div>
          {data && data.items.length === 0 && <p className="text-sm text-neutral-500">No projects match. Run a sync to pull Houston projects from TDLR.</p>}
          {data && data.items.length > 0 && <ProjectsTable rows={data.items} onOpen={setOpenId} onFind={setFindId} />}
          {pages > 1 && (
            <div className="flex items-center justify-end gap-2 text-sm">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => set("page", String(page - 1))}>Previous</Button>
              <span>Page {page} of {pages}</span>
              <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => set("page", String(page + 1))}>Next</Button>
            </div>
          )}
        </div>
      </div>
      <ProjectDrawer id={openId} onClose={() => setOpenId(null)} onFind={(id) => { setOpenId(null); setFindId(id); }} />
      <FindBusinessDialog projectId={findId} open={!!findId} onOpenChange={(o) => { if (!o) setFindId(null); }} onDone={() => load()} />
    </div>
  );
}
