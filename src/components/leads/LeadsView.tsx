"use client";

import { useCallback, useEffect, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import type { LeadRow } from "@/lib/leads/queries";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { LeadFilters } from "./LeadFilters";
import { LeadsTable } from "./LeadsTable";
import { useLeadFilters } from "./useLeadFilters";

type ListResponse = { items: LeadRow[]; total: number; page: number; pageSize: number; runningSearches: number };

export function LeadsView({
  renderDrawer,
  renderBulkBar,
}: {
  renderDrawer?: (id: string | null, close: () => void, refresh: () => void) => React.ReactNode;
  renderBulkBar?: (ids: string[], clear: () => void, refresh: () => void) => React.ReactNode;
}) {
  const { params, set } = useLeadFilters();
  const [data, setData] = useState<ListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/businesses?${params.toString()}`, { cache: "no-store" });
    if (!res.ok) return setError((await res.json()).error ?? "Failed to load");
    setError(null);
    setData(await res.json());
  }, [params]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!data?.runningSearches) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [data?.runningSearches, load]);

  const page = data?.page ?? 1;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="flex flex-col gap-4 md:flex-row">
      <aside className="hidden w-64 shrink-0 md:block">
        <div className="sticky top-20 rounded-lg border bg-white p-4 dark:bg-neutral-900"><LeadFilters /></div>
      </aside>

      <div className="min-w-0 flex-1 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm text-neutral-500" data-testid="leads-count">
            {data ? `${data.total} lead${data.total === 1 ? "" : "s"}` : "Loading…"}
            {data?.runningSearches ? " · search running, updating live" : ""}
          </div>
          <div className="flex items-center gap-2">
            <Sheet>
              <SheetTrigger render={<Button variant="outline" size="sm" className="md:hidden" />}>
                <SlidersHorizontal className="mr-1 h-4 w-4" />Filters
              </SheetTrigger>
              <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto p-4">
                <SheetTitle className="mb-3">Filters</SheetTitle>
                <LeadFilters />
              </SheetContent>
            </Sheet>
            {/* Base UI translation: the Button primitive assumes a native <button> (nativeButton
                defaults to true) and warns when `render` swaps in an <a>; nativeButton={false}
                tells it the rendered element supplies its own semantics. */}
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<a href={`/api/export?${params.toString()}`} data-testid="export-csv" />}
            >
              Export CSV
            </Button>
          </div>
        </div>

        {renderBulkBar?.([...selected], () => setSelected(new Set()), load)}

        {error && <p className="text-sm text-red-600">{error}</p>}
        {data && data.items.length === 0 && <p className="text-sm text-neutral-500">No leads match these filters.</p>}
        {data && data.items.length > 0 && (
          <LeadsTable
            rows={data.items}
            selectedIds={selected}
            onToggle={(id, c) => setSelected((prev) => { const n = new Set(prev); c ? n.add(id) : n.delete(id); return n; })}
            onToggleAll={(c) => setSelected(c ? new Set(data.items.map((r) => r.id)) : new Set())}
            onOpen={setOpenId}
          />
        )}

        {pages > 1 && (
          <div className="flex items-center justify-end gap-2 text-sm">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => set("page", String(page - 1))}>Previous</Button>
            <span>Page {page} of {pages}</span>
            <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => set("page", String(page + 1))}>Next</Button>
          </div>
        )}
      </div>

      {renderDrawer?.(openId, () => setOpenId(null), load)}
    </div>
  );
}
