"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { timeAgo } from "@/lib/format";
import type { ScannerPayload } from "./types";

type T = ScannerPayload["targets"][number];

export function TargetsCard({ targets, onChanged }: { targets: T[]; onChanged: () => void }) {
  const [zip, setZip] = useState("");

  async function call(url: string, init: RequestInit, okMsg: string): Promise<boolean> {
    const r = await fetch(url, { headers: { "content-type": "application/json" }, ...init });
    if (!r.ok) {
      toast.error((await r.json().catch(() => ({}))).error ?? "Request failed");
      return false;
    }
    toast.success(okMsg);
    onChanged();
    return true;
  }
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{5}$/.test(zip)) return toast.error("Enter a 5-digit zip");
    if (await call("/api/scanner/targets", { method: "POST", body: JSON.stringify({ zip }) }, `Added ${zip}`)) setZip("");
  };
  const patch = (t: T, body: Partial<Pick<T, "priority" | "paused">>, msg: string) =>
    call(`/api/scanner/targets/${t.id}`, { method: "PATCH", body: JSON.stringify(body) }, msg);
  const remove = (t: T) => call(`/api/scanner/targets/${t.id}`, { method: "DELETE" }, `Removed ${t.zip}`);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Target zips</CardTitle>
        <form onSubmit={add} className="flex gap-2">
          <Input value={zip} onChange={(e) => setZip(e.target.value.replace(/\D/g, "").slice(0, 5))} placeholder="Add zip" inputMode="numeric" className="h-8 w-28" aria-label="Add zip" data-testid="target-zip" />
          <Button type="submit" size="sm" data-testid="target-add">Add</Button>
        </form>
      </CardHeader>
      <CardContent>
        {targets.length === 0 ? <p className="text-sm text-muted-foreground">No targets yet. Add a zip, or let hot TDLR projects add theirs.</p> : (
          <ul className="divide-y" data-testid="targets">
            {targets.map((t, i) => (
              <li key={t.id} className="flex flex-wrap items-center gap-2 py-2 text-sm" data-testid="target-row">
                <span className="w-16 font-medium">{t.zip}</span>
                <Badge variant="outline">{t.addedBy === "auto_tdlr" ? "TDLR" : "You"}</Badge>
                <span className="text-xs text-muted-foreground">priority {t.priority}</span>
                <span className="text-xs text-muted-foreground">{t.lastSearchedAt ? `searched ${timeAgo(t.lastSearchedAt)}` : "never searched"}</span>
                {t.paused && <Badge className="border-0 bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">paused</Badge>}
                <span className="ml-auto flex gap-1">
                  <Button size="sm" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => patch(t, { priority: (targets[i - 1]?.priority ?? t.priority) + 1 }, "Moved up")}>↑</Button>
                  <Button size="sm" variant="ghost" aria-label="Move down" disabled={i === targets.length - 1} onClick={() => patch(t, { priority: Math.max(0, (targets[i + 1]?.priority ?? t.priority) - 1) }, "Moved down")}>↓</Button>
                  <Button size="sm" variant="ghost" onClick={() => patch(t, { paused: !t.paused }, t.paused ? "Target resumed" : "Target paused")}>{t.paused ? "Resume" : "Pause"}</Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(t)}>Remove</Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
