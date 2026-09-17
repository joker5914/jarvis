"use client";

import Link from "next/link";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { LeadDetail } from "./LeadDetail";

export function LeadDrawer({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged: () => void }) {
  return (
    <Sheet open={!!id} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-xl">
        <SheetTitle className="sr-only">Lead detail</SheetTitle>
        {id && (
          <>
            <div className="sticky top-0 z-10 flex h-12 items-center border-b bg-background pl-5 pr-14">
              <Link href={`/leads/${id}`} className="text-sm text-blue-600 hover:underline dark:text-blue-400">Open full page</Link>
            </div>
            <div className="p-5">
              <LeadDetail id={id} onChanged={onChanged} />
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
