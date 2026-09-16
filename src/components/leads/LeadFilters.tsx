"use client";

import { useEffect, useState } from "react";
import type { Tag } from "@prisma/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CATEGORIES } from "@/lib/config/categories";
import { PRODUCTS } from "@/lib/config/packages";
import { titleCase } from "@/lib/format";
import { useLeadFilters } from "./useLeadFilters";

const ANY = "__any";

function Choice({
  id, label, value, onChange, options,
}: { id: string; label: string; value: string; onChange: (v: string | null) => void; options: { value: string; label: string }[] }) {
  const items = [{ value: ANY, label: "Any" }, ...options];
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      {/* Base UI translation: pass `items` so the trigger shows the matching label
          immediately, since <Select.Value> otherwise resolves labels only from
          <Select.Item>s that have already mounted in the (portalled, closed-by-default) popup. */}
      <Select value={value || ANY} onValueChange={(v) => onChange(v === ANY || v == null ? null : v)} items={items}>
        <SelectTrigger id={id}><SelectValue placeholder="Any" /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>Any</SelectItem>
          {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

export function LeadFilters() {
  const { params, set, reset } = useLeadFilters();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [tags, setTags] = useState<Tag[]>([]);

  useEffect(() => {
    fetch("/api/tags").then((r) => r.json()).then((d) => setTags(d.items ?? []));
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      if ((params.get("q") ?? "") !== q) set("q", q || null);
    }, 300);
    return () => clearTimeout(t);
  }, [q, params, set]);

  const statuses = ["not_contacted", "contacted", "interested", "not_a_fit", "customer"];

  return (
    <div className="space-y-4" data-testid="lead-filters">
      <div className="space-y-1">
        <Label htmlFor="f-q">Search</Label>
        <Input id="f-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Business name" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="f-zip">Zip</Label>
        <Input id="f-zip" defaultValue={params.get("zip") ?? ""} inputMode="numeric" maxLength={5}
          onBlur={(e) => set("zip", /^\d{5}$/.test(e.target.value) ? e.target.value : null)} />
      </div>
      <Choice id="f-category" label="Category" value={params.get("category") ?? ""} onChange={(v) => set("category", v)}
        options={CATEGORIES.map((c) => ({ value: c.slug, label: c.label }))} />
      <Choice id="f-quality" label="Contact quality" value={params.get("quality") ?? ""} onChange={(v) => set("quality", v)}
        options={["green", "yellow", "red"].map((v) => ({ value: v, label: titleCase(v) }))} />
      <Choice id="f-status" label="Outreach status" value={params.get("status") ?? ""} onChange={(v) => set("status", v)}
        options={statuses.map((v) => ({ value: v, label: titleCase(v) }))} />
      <Choice id="f-source" label="Source" value={params.get("source") ?? ""} onChange={(v) => set("source", v)}
        options={[{ value: "zip_search", label: "Zip search" }, { value: "tdlr", label: "TDLR" }, { value: "manual", label: "Manual" }]} />
      <Choice id="f-tag" label="Tag" value={params.get("tag") ?? ""} onChange={(v) => set("tag", v)}
        options={tags.filter((t) => !t.isSystem).map((t) => ({ value: t.name, label: t.name }))} />
      <Choice id="f-product" label="Product pitched" value={params.get("product") ?? ""} onChange={(v) => set("product", v)}
        options={PRODUCTS.map((p) => ({ value: p.slug, label: p.label }))} />
      <Choice id="f-sort" label="Sort" value={params.get("sort") ?? ""} onChange={(v) => set("sort", v)}
        options={[{ value: "quality", label: "Contact quality" }, { value: "name", label: "Name" }, { value: "updated", label: "Recently updated" }]} />
      <div className="flex items-center gap-2">
        <Checkbox id="f-excluded" checked={params.get("showExcluded") === "true"}
          onCheckedChange={(c) => set("showExcluded", c ? "true" : null)} />
        <Label htmlFor="f-excluded">Show excluded (enterprise)</Label>
      </div>
      <Button variant="outline" size="sm" onClick={() => { setQ(""); reset(); }}>Clear filters</Button>
    </div>
  );
}
