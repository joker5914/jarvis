import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { timeAgo } from "@/lib/format";
import type { ScannerPayload } from "./types";

export function ScannerActivity({ items }: { items: ScannerPayload["activity"] }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Activity</CardTitle></CardHeader>
      <CardContent>
        {items.length === 0 ? <p className="text-sm text-neutral-500">No Scanner activity yet.</p> : (
          <ul className="space-y-1 text-sm" data-testid="scanner-activity">
            {items.map((a) => <li key={a.id} className="flex gap-2"><span className="w-20 shrink-0 text-xs text-neutral-400">{timeAgo(a.createdAt)}</span><span>{a.message}</span></li>)}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
