"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ScannerPayload } from "./types";

type S = ScannerPayload["schedule"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** ISO → value for <input type="datetime-local"> in the browser's local zone. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const fromLocalInput = (v: string): string | null => (v ? new Date(v).toISOString() : null);

export function ScheduleForm({ schedule, onSaved }: { schedule: S; onSaved: () => void }) {
  const [s, setS] = useState<S>(schedule);
  const [busy, setBusy] = useState(false);
  useEffect(() => setS(schedule), [schedule]);
  const num = (k: keyof S) => (e: React.ChangeEvent<HTMLInputElement>) => setS({ ...s, [k]: Number(e.target.value) });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await fetch("/api/scanner/schedule", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...s, windowStart: s.windowStart, windowEnd: s.windowEnd, dailyStartTime: s.dailyStartTime || null, dailyEndTime: s.dailyEndTime || null }),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? "Save failed");
      toast.success("Schedule saved");
      onSaved();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Schedule</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={save} className="grid gap-4 md:grid-cols-2" data-testid="schedule-form">
          <label className="flex items-center gap-2 md:col-span-2">
            <Checkbox checked={s.enabled} onCheckedChange={(c) => setS({ ...s, enabled: !!c })} data-testid="schedule-enabled" />
            <span className="font-medium">Scanner enabled</span>
          </label>
          <div className="space-y-1">
            <Label htmlFor="ws">Window start</Label>
            <Input id="ws" type="datetime-local" value={toLocalInput(s.windowStart)} onChange={(e) => setS({ ...s, windowStart: fromLocalInput(e.target.value) })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="we">Window end</Label>
            <Input id="we" type="datetime-local" value={toLocalInput(s.windowEnd)} onChange={(e) => setS({ ...s, windowEnd: fromLocalInput(e.target.value) })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ds">Daily start (HH:mm)</Label>
            <Input id="ds" type="time" value={s.dailyStartTime ?? ""} onChange={(e) => setS({ ...s, dailyStartTime: e.target.value || null })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="de">Daily end (HH:mm)</Label>
            <Input id="de" type="time" value={s.dailyEndTime ?? ""} onChange={(e) => setS({ ...s, dailyEndTime: e.target.value || null })} />
          </div>
          <div className="md:col-span-2">
            <Label>Days of week (none = every day)</Label>
            <div className="mt-1 flex flex-wrap gap-3">
              {DAYS.map((d, i) => (
                <label key={d} className="flex items-center gap-1 text-sm">
                  <Checkbox checked={s.daysOfWeek.includes(i)} onCheckedChange={(c) => setS({ ...s, daysOfWeek: c ? [...s.daysOfWeek, i].sort() : s.daysOfWeek.filter((x) => x !== i) })} />
                  {d}
                </label>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="tz">Timezone</Label>
            <Input id="tz" value={s.timezone} onChange={(e) => setS({ ...s, timezone: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="mc">Max concurrent scanner jobs</Label>
            <Input id="mc" type="number" min={1} max={2} value={s.maxConcurrentJobs} onChange={num("maxConcurrentJobs")} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="zr">Re-search each zip every (days)</Label>
            <Input id="zr" type="number" min={1} max={90} value={s.zipRefreshDays} onChange={num("zipRefreshDays")} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="th">TDLR sync every (hours)</Label>
            <Input id="th" type="number" min={1} max={168} value={s.tdlrSyncHours} onChange={num("tdlrSyncHours")} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="wr">Re-check websites every (days)</Label>
            <Input id="wr" type="number" min={1} max={365} value={s.websiteRecheckDays} onChange={num("websiteRecheckDays")} />
          </div>
          <label className="flex items-center gap-2">
            <Checkbox checked={s.autoAddHotZips} onCheckedChange={(c) => setS({ ...s, autoAddHotZips: !!c })} />
            <span className="text-sm">Auto-add zips of hot TDLR projects</span>
          </label>
          <div className="md:col-span-2">
            <Button type="submit" disabled={busy} data-testid="schedule-save">{busy ? "Saving…" : "Save schedule"}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
