"use client";

import { Suspense } from "react";
import { LeadsView } from "@/components/leads/LeadsView";
import { LeadDrawer } from "@/components/leads/LeadDrawer";
import { BulkBar } from "@/components/leads/BulkBar";
import type { CategoryOption } from "@/components/leads/LeadFilters";

/**
 * Function props (`renderDrawer`/`renderBulkBar`) can only cross a Server -> Client boundary
 * when the receiving component is itself a Client Component, since plain closures aren't
 * serializable. `src/app/leads/page.tsx` is a Server Component (it calls `getActor()` +
 * `loadConfig()` to compute `categories`), so this thin client wrapper takes the already
 * server-loaded, serializable `categories` prop and owns the render-prop wiring that used to
 * live directly in the page.
 */
export function LeadsPageClient({ categories }: { categories?: CategoryOption[] }) {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
      <LeadsView
        categories={categories}
        renderDrawer={(id, close, refresh) => <LeadDrawer id={id} onClose={close} onChanged={refresh} />}
        renderBulkBar={(ids, clear, refresh) => <BulkBar ids={ids} clear={clear} refresh={refresh} />}
      />
    </Suspense>
  );
}
