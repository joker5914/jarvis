"use client";

import { useEffect, useState } from "react";
import type { Tag } from "@prisma/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { titleCase } from "@/lib/format";

const STATUSES = ["not_contacted", "contacted", "interested", "not_a_fit", "customer"];

export function BulkBar({ ids, clear, refresh }: { ids: string[]; clear: () => void; refresh: () => void }) {
  const [tags, setTags] = useState<Tag[]>([]);

  useEffect(() => {
    fetch("/api/tags").then((r) => r.json()).then((d) => setTags((d.items ?? []).filter((t: Tag) => !t.isSystem)));
  }, []);

  if (ids.length === 0) return null;

  async function apply(body: Record<string, unknown>) {
    const res = await fetch("/api/businesses/bulk", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids, ...body }) });
    if (!res.ok) return toast.error("Bulk update failed");
    const { updated } = await res.json();
    toast.success(`Updated ${updated} lead${updated === 1 ? "" : "s"}`);
    clear();
    refresh();
  }

  // Base UI translation: pass `items` so the trigger shows the matching label
  const STATUS_ITEMS = STATUSES.map((s) => ({ value: s, label: titleCase(s) }));
  const TAG_ITEMS = tags.map((t) => ({ value: t.id, label: t.name }));

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-blue-50 p-2 text-sm dark:bg-blue-950" data-testid="bulk-bar">
      <span className="font-medium">{ids.length} selected</span>
      <Select onValueChange={(v) => { if (v != null) apply({ outreachStatus: v }); }} items={STATUS_ITEMS}>
        <SelectTrigger className="h-8 w-44"><SelectValue placeholder="Set status…" /></SelectTrigger>
        <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{titleCase(s)}</SelectItem>)}</SelectContent>
      </Select>
      <Select onValueChange={(v) => { if (v != null) apply({ addTagId: v }); }} items={TAG_ITEMS}>
        <SelectTrigger className="h-8 w-44"><SelectValue placeholder="Add tag…" /></SelectTrigger>
        <SelectContent>
          {tags.length === 0 && <SelectItem value="__none" disabled>No tags yet</SelectItem>}
          {tags.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
        </SelectContent>
      </Select>
      <Button variant="ghost" size="sm" onClick={clear}>Clear</Button>
    </div>
  );
}
