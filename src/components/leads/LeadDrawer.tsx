"use client";

import Link from "next/link";
import { XIcon } from "lucide-react";
import { Sheet, SheetClose, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { LeadDetail } from "./LeadDetail";

export function LeadDrawer({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged: () => void }) {
  return (
    <Sheet open={!!id} onOpenChange={(o) => { if (!o) onClose(); }}>
      {/* showCloseButton={false}: the sheet's own close is absolutely positioned inside
          the popup, so it scrolls out of view with the rest of the content. This drawer
          puts its own close inside the sticky chrome row instead, alongside the "Open
          full page" link, so exactly one × exists and it stays visible while scrolling. */}
      {/* Desktop: the right third of the viewport (never narrower than 480 px) so contact rows,
          the enrich row and the activity log read on one line each; phones keep full width. */}
      <SheetContent side="right" className="overflow-y-auto p-0 data-[side=right]:w-full data-[side=right]:sm:w-[max(33vw,480px)] data-[side=right]:sm:max-w-none" showCloseButton={false}>
        <SheetTitle className="sr-only">Lead detail</SheetTitle>
        {id && (
          <>
            <div className="sticky top-0 z-10 flex h-12 items-center justify-between border-b bg-background px-5">
              <Link href={`/leads/${id}`} className="text-sm text-blue-600 hover:underline dark:text-blue-400">Open full page</Link>
              <SheetClose data-slot="sheet-close" render={<Button variant="ghost" size="icon-sm" aria-label="Close" />}>
                <XIcon />
                <span className="sr-only">Close</span>
              </SheetClose>
            </div>
            <div className="p-5">
              {/* key={id}: belt-and-braces alongside LeadDetail's own id-effect cleanup — forces a
                  fresh mount per lead so an in-flight enrich watch for the previous lead can
                  never leave its state (e.g. a stuck "Enriching…" button) on the next one. */}
              <LeadDetail key={id} id={id} onChanged={onChanged} />
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
