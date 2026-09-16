"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { formatDate, timeAgo, titleCase } from "@/lib/format";
import type { SmbFitThresholds } from "@/lib/scoring/smbFit";
import { TimingBadge } from "./TimingBadge";
import { FitBadge } from "./FitBadge";

type Detail = {
  id: string; projectNumber: string; projectName: string; facilityName: string | null; locationAddress: string | null; city: string | null; zip: string | null; county: string | null;
  statusLabel: string | null; workType: string | null; estimatedCost: number | null; squareFootage: number | null; tenantFunded: boolean | null; fundsType: string | null; scopeOfWork: string | null;
  startDate: string | null; completionDate: string | null; registrationDate: string | null; ownerName: string | null; ownerAddress: string | null; ownerPhone: string | null; contactName: string | null;
  tenantName: string | null; designFirmName: string | null; rasName: string | null; smbFitScore: number; smbFitReasons: { code: string; points: number; detail: string }[] | null;
  exclusion: string; exclusionReasons: string[]; timingWindow: string | null;
  business: { id: string; name: string; contactQualityBand: string; outreachStatus: string } | null;
  activity: { id: string; kind: string; message: string; createdAt: string }[];
};

const money = (n: number | null) => (n == null ? "—" : `$${Math.round(n).toLocaleString()}`);

export function ProjectDrawer({ id, onClose, onFind, thresholds }: { id: string | null; onClose: () => void; onFind: (id: string) => void; thresholds?: SmbFitThresholds }) {
  const [p, setP] = useState<Detail | null>(null);

  useEffect(() => {
    if (!id) return;
    setP(null);
    fetch(`/api/projects/${id}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("load failed"))))
      .then((d) => setP(d.project))
      .catch(() => toast.error("Could not load project"));
  }, [id]);

  return (
    <Sheet open={!!id} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full overflow-y-auto p-5 sm:max-w-xl">
        <SheetTitle className="sr-only">Project detail</SheetTitle>
        {!p ? <p className="text-sm text-muted-foreground">Loading…</p> : (
          <div className="space-y-4" data-testid="project-detail">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-semibold">{p.facilityName || p.projectName}</h2>
                <FitBadge score={p.smbFitScore} excluded={p.exclusion !== "none"} thresholds={thresholds} />
                <TimingBadge window={p.timingWindow} />
              </div>
              <p className="text-sm text-muted-foreground">{p.projectName} · {p.projectNumber} · {p.statusLabel}</p>
              <p className="text-sm">{[p.locationAddress, p.city, p.zip].filter(Boolean).join(", ")}{p.county ? ` (${p.county} County)` : ""}</p>
              {p.exclusion !== "none" && <p className="mt-1 text-xs text-red-600">Excluded: {p.exclusionReasons.join(", ")}</p>}
            </div>
            <Separator />
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Work type</dt><dd>{titleCase(p.workType)}</dd>
              <dt className="text-muted-foreground">Estimated cost</dt><dd>{money(p.estimatedCost)}</dd>
              <dt className="text-muted-foreground">Square feet</dt><dd>{p.squareFootage?.toLocaleString() ?? "—"}</dd>
              <dt className="text-muted-foreground">Tenant funded</dt><dd>{p.tenantFunded == null ? "—" : p.tenantFunded ? "Yes" : "No"}</dd>
              <dt className="text-muted-foreground">Start</dt><dd>{formatDate(p.startDate) || "—"}</dd>
              <dt className="text-muted-foreground">Completion</dt><dd>{formatDate(p.completionDate) || "—"}</dd>
              <dt className="text-muted-foreground">Registered</dt><dd>{formatDate(p.registrationDate) || "—"}</dd>
            </dl>
            {p.scopeOfWork && <p className="text-sm"><span className="text-muted-foreground">Scope:</span> {p.scopeOfWork}</p>}
            {p.smbFitReasons && p.smbFitReasons.length > 0 && (
              <p className="text-xs text-muted-foreground">Fit: {p.smbFitReasons.map((r) => `${r.detail} (${r.points > 0 ? "+" : ""}${r.points})`).join(", ")}</p>
            )}
            <Separator />
            <section className="space-y-1 text-sm">
              <h3 className="font-medium">People</h3>
              {p.ownerName && <p>Owner: {p.ownerName}{p.ownerPhone ? ` · ${p.ownerPhone}` : ""}</p>}
              {p.contactName && p.contactName !== p.ownerName && <p>Contact: {p.contactName}</p>}
              {p.tenantName && <p>Tenant: {p.tenantName}</p>}
              {p.designFirmName && <p>Design firm: {p.designFirmName}</p>}
              {p.rasName && <p className="text-muted-foreground">RAS: {p.rasName}</p>}
            </section>
            <Separator />
            <section className="space-y-2">
              <h3 className="font-medium">Lead</h3>
              {p.business ? (
                <p className="text-sm">
                  Linked to <Link href={`/leads/${p.business.id}`} className="text-blue-600 hover:underline">{p.business.name}</Link>
                  {" "}· {titleCase(p.business.outreachStatus)} · quality {p.business.contactQualityBand}
                </p>
              ) : p.exclusion === "none" ? (
                <Button size="sm" onClick={() => onFind(p.id)} data-testid="drawer-find-business">Find business</Button>
              ) : (
                <p className="text-sm text-muted-foreground">Excluded projects are not promoted.</p>
              )}
            </section>
            <Separator />
            <section>
              <h3 className="font-medium">Activity</h3>
              <ul className="mt-2 space-y-1 text-sm">
                {p.activity.map((a) => <li key={a.id} className="flex gap-2"><span className="w-20 shrink-0 text-xs text-muted-foreground">{timeAgo(a.createdAt)}</span><span>{a.message}</span></li>)}
                {p.activity.length === 0 && <li className="text-muted-foreground">No activity yet.</li>}
              </ul>
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
