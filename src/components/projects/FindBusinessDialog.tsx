"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Candidate = { placeId: string; name: string; formattedAddress: string | null; zip: string | null; websiteUrl: string | null; rating: number | null };
type State = { phase: "searching" } | { phase: "linked"; businessId: string } | { phase: "choose"; candidates: Candidate[] } | { phase: "error"; message: string };

export function FindBusinessDialog({ projectId, open, onOpenChange, onDone }: { projectId: string | null; open: boolean; onOpenChange: (o: boolean) => void; onDone: (businessId: string) => void }) {
  const [state, setState] = useState<State>({ phase: "searching" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !projectId) return;
    setState({ phase: "searching" });
    fetch(`/api/projects/${projectId}/find`, { method: "POST" })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Find failed");
        if (d.linked) {
          toast.success("Linked to a Google listing; gathering contacts");
          setState({ phase: "linked", businessId: d.businessId });
          onDone(d.businessId);
          onOpenChange(false);
        } else {
          setState({ phase: "choose", candidates: d.candidates });
        }
      })
      .catch((e) => setState({ phase: "error", message: (e as Error).message }));
  }, [open, projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function promote(body: { placeId?: string; createFromProject?: boolean }) {
    if (!projectId) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/projects/${projectId}/promote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Promote failed");
      toast.success(body.createFromProject ? "Lead created from project" : "Linked; gathering contacts");
      onDone(d.businessId);
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="find-dialog">
        <DialogHeader>
          <DialogTitle>Find this business on Google</DialogTitle>
          <DialogDescription>Match the project to a Google listing so contacts can be gathered, or create a lead from the project details.</DialogDescription>
        </DialogHeader>
        {state.phase === "searching" && <p className="text-sm text-neutral-500">Searching…</p>}
        {state.phase === "error" && <p className="text-sm text-red-600">{state.message}</p>}
        {state.phase === "choose" && (
          <ul className="space-y-2">
            {state.candidates.length === 0 && <li className="text-sm text-neutral-500">No Google listing found yet. Businesses that have not opened often have none.</li>}
            {state.candidates.map((c) => (
              <li key={c.placeId} className="flex items-center justify-between gap-3 rounded-md border p-2 text-sm">
                <div>
                  <div className="font-medium">{c.name}{c.rating != null ? <span className="ml-1 text-xs text-neutral-500">★ {c.rating}</span> : null}</div>
                  <div className="text-xs text-neutral-500">{c.formattedAddress}</div>
                </div>
                <Button size="sm" disabled={busy} onClick={() => promote({ placeId: c.placeId })}>Link</Button>
              </li>
            ))}
          </ul>
        )}
        <DialogFooter>
          {state.phase === "choose" && (
            <Button variant="outline" disabled={busy} onClick={() => promote({ createFromProject: true })} data-testid="create-from-project">Create lead from project</Button>
          )}
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
