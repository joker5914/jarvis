"use client";

import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate, timeAgo, titleCase } from "@/lib/format";
import type { ScannerPayload } from "./types";

const DOT: Record<string, string> = {
  running: "bg-emerald-500",
  idle: "bg-blue-500",
  paused: "bg-amber-500",
  outside_window: "bg-neutral-400",
  budget_exhausted: "bg-red-500",
  disabled: "bg-neutral-300",
};

export async function scannerAction(action: "pause" | "resume" | "stop" | "run-now"): Promise<boolean> {
  const r = await fetch(`/api/scanner/${action}`, { method: "POST" });
  if (!r.ok) {
    toast.error(`Could not ${action.replace("-", " ")} the Scanner`);
    return false;
  }
  toast.success({ pause: "Scanner paused", resume: "Scanner resumed", stop: "Scanner stopped", "run-now": "Tick requested" }[action]);
  window.dispatchEvent(new Event("scanner:changed"));
  return true;
}

export function StatusCard({ data, onChanged }: { data: ScannerPayload; onChanged: () => void }) {
  const { state, window, budget } = data;
  const status = state.status;
  const act = async (a: Parameters<typeof scannerAction>[0]) => { if (await scannerAction(a)) onChanged(); };
  const next = state.nextPlanned?.at ? new Date(state.nextPlanned.at) : null;
  return (
    <Card data-testid="scanner-status">
      <CardContent className="flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <span className={`h-3 w-3 rounded-full ${DOT[status] ?? "bg-neutral-300"}`} />
            <span className="text-2xl font-semibold" data-testid="scanner-state">{titleCase(status)}</span>
          </div>
          <p className="text-sm text-neutral-600 dark:text-neutral-300">
            {state.currentActivity ?? (status === "outside_window" ? `Outside the operating window (${window.reason ?? "closed"})` : status === "disabled" ? "Enable the schedule below to start scanning." : status === "paused" ? (state.lastError ? `Paused: ${state.lastError}` : "Paused; resume when ready.") : "Nothing running.")}
          </p>
          <p className="text-xs text-muted-foreground">
            {next ? `Next: ${state.nextPlanned?.detail ?? state.nextPlanned?.kind} at ${formatDate(next)} ${next.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : state.nextPlanned?.detail ?? ""}
            {state.lastTickAt ? ` · last tick ${timeAgo(state.lastTickAt)}` : ""}
            {` · Google budget ${budget.used}/${budget.limit}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {state.pauseRequested || status === "paused" ? (
            <Button onClick={() => act("resume")} data-testid="scanner-resume">Resume</Button>
          ) : (
            <Button variant="outline" onClick={() => act("pause")} data-testid="scanner-pause" disabled={status === "disabled"}>Pause</Button>
          )}
          <Button variant="outline" onClick={() => act("run-now")} data-testid="scanner-run-now" disabled={!data.schedule.enabled}>Run now</Button>
          <Button variant="destructive" onClick={() => act("stop")} data-testid="scanner-stop" disabled={status === "disabled"}>Stop</Button>
        </div>
      </CardContent>
    </Card>
  );
}
