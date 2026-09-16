"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Tag } from "@prisma/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { titleCase } from "@/lib/format";

const STATUSES = ["not_contacted", "contacted", "interested", "not_a_fit", "customer"];

export function BulkBar({ ids, clear, refresh }: { ids: string[]; clear: () => void; refresh: () => void }) {
  const router = useRouter();
  const [tags, setTags] = useState<Tag[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/tags").then((r) => r.json()).then((d) => setTags((d.items ?? []).filter((t: Tag) => !t.isSystem)));
  }, []);

  if (ids.length === 0) return null;

  async function apply(body: Record<string, unknown>) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/businesses/bulk", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids, ...body }) });
      if (!res.ok) return toast.error("Bulk update failed");
      const { updated } = await res.json();
      toast.success(`Updated ${updated} lead${updated === 1 ? "" : "s"}`);
      clear();
      refresh();
    } finally {
      setBusy(false);
    }
  }

  async function enrichSelected() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/businesses/bulk", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids, enrich: true }) });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) {
        toast.error(data.error ?? "Apollo is not configured", {
          action: { label: "Settings", onClick: () => router.push(data.settingsHref ?? "/settings") },
        });
        return;
      }
      if (!res.ok) { toast.error(data.error ?? "Bulk enrich failed"); return; }
      const { enrichQueued, enrichFailed, enrichSkipped } = data;
      toast.success(
        `Queued ${enrichQueued} for enrichment${enrichSkipped ? `, ${enrichSkipped} excluded (skipped)` : ""}${enrichFailed ? `, ${enrichFailed} failed` : ""}`,
      );
      clear();
      refresh();
    } finally {
      setBusy(false);
    }
  }

  // Base UI translation: pass `items` so the trigger shows the matching label
  const STATUS_ITEMS = STATUSES.map((s) => ({ value: s, label: titleCase(s) }));
  const TAG_ITEMS = tags.map((t) => ({ value: t.id, label: t.name }));

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-blue-50 p-2 text-sm dark:bg-blue-950" data-testid="bulk-bar">
      <span className="font-medium">{ids.length} selected</span>
      <Select onValueChange={(v) => { if (v != null) apply({ outreachStatus: v }); }} items={STATUS_ITEMS} disabled={busy}>
        <SelectTrigger className="h-8 w-44"><SelectValue placeholder="Set status…" /></SelectTrigger>
        <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{titleCase(s)}</SelectItem>)}</SelectContent>
      </Select>
      <Select onValueChange={(v) => { if (v != null) apply({ addTagId: v }); }} items={TAG_ITEMS} disabled={busy}>
        <SelectTrigger className="h-8 w-44"><SelectValue placeholder="Add tag…" /></SelectTrigger>
        <SelectContent>
          {tags.length === 0 && <SelectItem value="__none" disabled>No tags yet</SelectItem>}
          {tags.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
        </SelectContent>
      </Select>
      <Button variant="outline" size="sm" data-testid="bulk-enrich" onClick={enrichSelected} disabled={busy}>Enrich</Button>
      <Button variant="ghost" size="sm" onClick={clear} disabled={busy}>Clear</Button>
    </div>
  );
}
