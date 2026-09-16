"use client";

import Link from "next/link";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { LeadDetail } from "./LeadDetail";

export function LeadDrawer({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged: () => void }) {
  return (
    <Sheet open={!!id} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full overflow-y-auto p-5 sm:max-w-xl">
        <SheetTitle className="sr-only">Lead detail</SheetTitle>
        {id && (
          <>
            <div className="mb-3 text-right">
              <Link href={`/leads/${id}`} className="text-xs text-blue-600 hover:underline">Open full page</Link>
            </div>
            <LeadDetail id={id} onChanged={onChanged} />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
