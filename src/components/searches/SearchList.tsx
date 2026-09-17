"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { Search } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SearchStatusBadge } from "./SearchStatusBadge";
import { ProgressBar } from "./ProgressBar";
import { timeAgo } from "@/lib/format";

type Progress = { step?: string; current?: number; total?: number; message?: string };

const STEP_LABELS: Record<string, string> = {
  geocode: "Locating zip",
  discover: "Finding businesses",
  details: "Fetching place details",
  save: "Saving businesses",
  scrape: "Extracting contacts from websites",
  validate: "Validating emails",
  score: "Scoring contact quality",
  complete: "Complete",
  paused: "Paused",
  failed: "Failed",
};

export function SearchList({ initial }: { initial: Search[] }) {
  const [items, setItems] = useState(initial);
  const active = items.some((s) => s.status === "queued" || s.status === "running");

  useEffect(() => {
    if (!active) return;
    const t = setInterval(async () => {
      const res = await fetch("/api/searches", { cache: "no-store" });
      if (res.ok) setItems((await res.json()).items);
    }, 2000);
    return () => clearInterval(t);
  }, [active]);

  async function rerun(id: string) {
    try {
      const res = await fetch(`/api/searches/${id}/rerun`, { method: "POST" });
      if (!res.ok) return toast.error("Could not re-run search");
      const { search } = await res.json();
      setItems((prev) => [search, ...prev]);
      toast.success(`Re-running ${search.zip}`);
    } catch {
      toast.error("Could not re-run search");
    }
  }

  async function resume(id: string) {
    try {
      const res = await fetch(`/api/searches/${id}/resume`, { method: "POST" });
      if (!res.ok) return toast.error("Could not resume search");
      const { search } = await res.json();
      setItems((prev) => prev.map((s) => (s.id === id ? search : s)));
      toast.success(`Resuming ${search.zip}`);
    } catch {
      toast.error("Could not resume search");
    }
  }

  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">No searches yet. Start one from the dashboard.</p>;
  }

  return (
    <div className="space-y-3" data-testid="search-list">
      {items.map((s) => {
        const p = (s.progress ?? {}) as Progress;
        const running = s.status === "queued" || s.status === "running";
        return (
          <Card key={s.id} data-testid="search-card" data-status={s.status}>
            <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center">
              <div className="min-w-40">
                <div className="text-lg font-semibold">{s.zip}</div>
                <div className="text-xs text-muted-foreground">
                  {s.city ? `${s.city}, ${s.state} · ` : ""}{timeAgo(s.createdAt)}
                </div>
              </div>
              <div className="flex-1">
                {running ? (
                  <ProgressBar current={p.current} total={p.total} label={`${STEP_LABELS[p.step ?? ""] ?? "Starting"}${p.message ? ` · ${p.message}` : ""}`} />
                ) : (
                  <div className="text-sm text-neutral-600 dark:text-neutral-300">
                    {s.countsFound} found · {s.countsScraped} websites scraped
                    {s.error && <span className="ml-2 text-red-600">{s.error}</span>}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <SearchStatusBadge status={s.status} />
                {s.origin === "scanner" && <Badge variant="outline">auto</Badge>}
                <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`/leads?searchId=${s.id}`} />}>
                  View leads
                </Button>
                {s.status === "paused" ? (
                  <Button variant="outline" size="sm" onClick={() => resume(s.id)}>
                    Resume
                  </Button>
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => rerun(s.id)} disabled={running}>
                    {s.status === "failed" ? "Retry" : "Re-run"}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
