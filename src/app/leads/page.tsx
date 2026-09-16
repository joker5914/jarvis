"use client";

import { Suspense } from "react";
import { LeadsView } from "@/components/leads/LeadsView";
import { LeadDrawer } from "@/components/leads/LeadDrawer";

export default function LeadsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Leads</h1>
      <Suspense fallback={<p className="text-sm text-neutral-500">Loading…</p>}>
        <LeadsView
          renderDrawer={(id, close, refresh) => <LeadDrawer id={id} onClose={close} onChanged={refresh} />}
        />
      </Suspense>
    </div>
  );
}
