"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLeadFilters } from "@/components/leads/useLeadFilters";
import { titleCase } from "@/lib/format";

const ANY = "__any";
type Opt = { value: string; label: string };

function Choice({ id, label, value, onChange, options }: { id: string; label: string; value: string; onChange: (v: string | null) => void; options: Opt[] }) {
  const items = [{ value: ANY, label: "Any" }, ...options];
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value || ANY} onValueChange={(v) => onChange(v === ANY || v == null ? null : v)} items={items}>
        <SelectTrigger id={id}><SelectValue /></SelectTrigger>
        <SelectContent>{items.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  );
}

const WORK_TYPES = ["new_construction", "renovation", "addition", "historic", "row"];
const TIMINGS = ["opening_soon", "under_construction", "planned", "just_completed", "stale"];

export function ProjectFilters() {
  const { params, set, reset } = useLeadFilters();
  const [q, setQ] = useState(params.get("q") ?? "");
  const dirty = useRef(false);

  useEffect(() => {
    if (!dirty.current) return;
    const t = setTimeout(() => {
      set("q", q || null);
      dirty.current = false;
    }, 300);
    return () => clearTimeout(t);
  }, [q, set]);
  useEffect(() => {
    if (!dirty.current) setQ(params.get("q") ?? "");
  }, [params]);

  return (
    <div className="space-y-4" data-testid="project-filters">
      <div className="space-y-1">
        <Label htmlFor="pf-q">Search</Label>
        <Input id="pf-q" value={q} onChange={(e) => { dirty.current = true; setQ(e.target.value); }} placeholder="Project or facility name" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="pf-zip">Zip</Label>
        <Input id="pf-zip" defaultValue={params.get("zip") ?? ""} inputMode="numeric" maxLength={5}
          onBlur={(e) => set("zip", /^\d{5}$/.test(e.target.value) ? e.target.value : null)} />
      </div>
      <Choice id="pf-timing" label="Timing" value={params.get("timing") ?? ""} onChange={(v) => set("timing", v)}
        options={TIMINGS.map((v) => ({ value: v, label: titleCase(v) }))} />
      <Choice id="pf-fit" label="SMB fit" value={params.get("fit") ?? ""} onChange={(v) => set("fit", v)}
        options={["high", "medium", "low"].map((v) => ({ value: v, label: titleCase(v) }))} />
      <Choice id="pf-work" label="Work type" value={params.get("workType") ?? ""} onChange={(v) => set("workType", v)}
        options={WORK_TYPES.map((v) => ({ value: v, label: titleCase(v) }))} />
      <Choice id="pf-linked" label="Linked to a lead" value={params.get("linked") ?? ""} onChange={(v) => set("linked", v)}
        options={[{ value: "true", label: "Linked" }, { value: "false", label: "Not linked" }]} />
      <Choice id="pf-sort" label="Sort" value={params.get("sort") ?? ""} onChange={(v) => set("sort", v)}
        options={[{ value: "completion", label: "Soonest completion" }, { value: "fit", label: "SMB fit" }, { value: "registered", label: "Recently registered" }]} />
      <div className="flex items-center gap-2">
        <Checkbox id="pf-excluded" checked={params.get("showExcluded") === "true"} onCheckedChange={(c) => set("showExcluded", c ? "true" : null)} />
        <Label htmlFor="pf-excluded">Show excluded (enterprise)</Label>
      </div>
      <Button variant="outline" size="sm" onClick={() => { dirty.current = false; setQ(""); reset(); }}>Clear filters</Button>
    </div>
  );
}
