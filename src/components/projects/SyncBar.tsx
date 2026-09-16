"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { timeAgo } from "@/lib/format";

type Cursor = { status: string; message?: string; current?: number; total?: number; error?: string | null; counts?: Record<string, number> };
type Status = {
  lastSuccessfulAt: string | null;
  cursor: Cursor;
  running: boolean;
  batch: { lastSuccessfulAt: string | null; cursor: Cursor; running: boolean };
};

export function SyncBar({ onActivity, onChanged }: { onActivity: (running: boolean) => void; onChanged: () => void }) {
  const [s, setS] = useState<Status | null>(null);
  const [statusFailed, setStatusFailed] = useState(false);
  const toastedRef = useRef(false);
  const wasRunningRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/projects/sync", { cache: "no-store" });
      if (!r.ok) throw new Error("failed");
      setS(await r.json());
      setStatusFailed(false);
      toastedRef.current = false;
    } catch {
      setStatusFailed(true);
      if (!toastedRef.current) {
        toastedRef.current = true;
        toast.error("Could not load sync status");
      }
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Derived from the server's isSyncRunning check (which discounts a cursor stuck at
  // "running" past RUNNING_STALE_MS), not the raw status string, so a crashed run doesn't
  // permanently disable the buttons below.
  const running = !!s?.running || !!s?.batch.running;
  useEffect(() => {
    onActivity(!!running);
    if (wasRunningRef.current && !running) onChanged();
    wasRunningRef.current = !!running;
    if (!running) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [running, load, onActivity, onChanged]);

  async function post(url: string, label: string) {
    const r = await fetch(url, { method: "POST" });
    if (r.status === 409) return toast.info(`${label} is already running`);
    if (!r.ok) return toast.error(`${label} failed to start`);
    toast.success(`${label} started`);
    setTimeout(load, 500);
    // A fast inline-mode job can finish before "running" is ever observed by
    // the status poll above, in which case the true->false transition never
    // fires onChanged(). This unconditional follow-up call picks up results
    // even when the running window was missed entirely.
    setTimeout(onChanged, 1200);
  }

  const c = s?.cursor;
  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-white p-3 text-sm md:flex-row md:items-center md:justify-between dark:bg-neutral-900" data-testid="sync-bar">
      <div>
        <span className="font-medium">TDLR sync:</span>{" "}
        {statusFailed && !s ? (
          <span className="text-red-600" data-testid="sync-status-unavailable">status unavailable</span>
        ) : c?.status === "running" && s?.running ? (
          <span>{c.message ?? "running"}{c.total ? ` (${c.current ?? 0}/${c.total})` : ""}</span>
        ) : c?.status === "running" && s?.running === false ? (
          <span className="text-amber-700" data-testid="sync-stale">last run did not finish; you can start a new one</span>
        ) : c?.status === "failed" ? (
          <span className="text-red-600">failed — {c.error}</span>
        ) : (
          <span className="text-muted-foreground">{s?.lastSuccessfulAt ? `last synced ${timeAgo(s.lastSuccessfulAt)}` : "never synced"}{c?.counts ? ` · ${c.counts.created ?? 0} new` : ""}</span>
        )}
        {s?.batch.cursor.status === "running" && s.batch.running && (
          <span className="ml-3 text-blue-700">Promoting high-fit projects {s.batch.cursor.current ?? 0}/{s.batch.cursor.total ?? 0}…</span>
        )}
        {s?.batch.cursor.status === "running" && s.batch.running === false && (
          <span className="ml-3 text-amber-700" data-testid="promote-stale">last promote run did not finish; you can start a new one</span>
        )}
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={!!running} onClick={() => post("/api/projects/sync", "Sync")} data-testid="sync-now">Sync now</Button>
        <Button size="sm" disabled={!!running} onClick={() => post("/api/projects/promote-high-fit", "Batch promote")} data-testid="promote-high-fit">Promote high-fit</Button>
      </div>
    </div>
  );
}
