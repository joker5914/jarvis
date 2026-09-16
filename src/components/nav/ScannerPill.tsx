"use client";

import { useCallback, useEffect, useState } from "react";
import { scannerAction } from "@/components/scanner/StatusCard";
import { titleCase } from "@/lib/format";

const DOT: Record<string, string> = { running: "bg-emerald-500", idle: "bg-blue-500", paused: "bg-amber-500", outside_window: "bg-neutral-400", budget_exhausted: "bg-red-500", disabled: "bg-neutral-300" };

export function ScannerPill() {
  const [s, setS] = useState<{ status: string; pauseRequested: boolean; currentActivity: string | null } | null>(null);
  const load = useCallback(async () => {
    const r = await fetch("/api/scanner", { cache: "no-store" }).catch(() => null);
    if (r?.ok) setS((await r.json()).state);
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);
  if (!s) return null;
  const paused = s.pauseRequested || s.status === "paused";
  return (
    <span data-testid="scanner-pill" className="hidden max-w-xs items-center gap-2 rounded-full border px-3 py-1 text-xs md:inline-flex">
      <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[s.status] ?? "bg-neutral-300"}`} />
      <span className="truncate">{s.currentActivity ?? `Scanner ${titleCase(s.status).toLowerCase()}`}</span>
      {s.status !== "disabled" && (
        <button type="button" className="ml-1 font-medium text-blue-600 hover:underline" data-testid="pill-toggle"
          onClick={async () => { if (await scannerAction(paused ? "resume" : "pause")) load(); }}>
          {paused ? "Resume" : "Pause"}
        </button>
      )}
    </span>
  );
}
