"use client";

import { Suspense } from "react";
import { LeadsView } from "@/components/leads/LeadsView";
import { LeadDrawer } from "@/components/leads/LeadDrawer";
import { BulkBar } from "@/components/leads/BulkBar";

export default function LeadsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Leads</h1>
      <Suspense fallback={<p className="text-sm text-neutral-500">Loading…</p>}>
        <LeadsView
          renderDrawer={(id, close, refresh) => <LeadDrawer id={id} onClose={close} onChanged={refresh} />}
          renderBulkBar={(ids, clear, refresh) => <BulkBar ids={ids} clear={clear} refresh={refresh} />}
        />
      </Suspense>
    </div>
  );
}
