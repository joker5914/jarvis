"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { StatusCard } from "./StatusCard";
import { ScheduleForm } from "./ScheduleForm";
import { TargetsCard } from "./TargetsCard";
import { ScannerActivity } from "./ScannerActivity";
import type { ScannerPayload } from "./types";

export function ScannerView() {
  const [data, setData] = useState<ScannerPayload | null>(null);
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/scanner", { cache: "no-store" });
      if (!r.ok) throw new Error();
      setData(await r.json());
    } catch {
      toast.error("Could not load Scanner status");
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(load, data?.state.status === "running" ? 5000 : 15000);
    return () => clearInterval(t);
  }, [load, data?.state.status]);

  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>;
  return (
    <div className="space-y-4">
      <StatusCard data={data} onChanged={load} />
      <div className="grid gap-4 lg:grid-cols-2">
        <ScheduleForm schedule={data.schedule} onSaved={load} />
        <TargetsCard targets={data.targets} onChanged={load} />
      </div>
      <ScannerActivity items={data.activity} />
    </div>
  );
}
