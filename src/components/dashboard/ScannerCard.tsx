import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { readScanner } from "@/lib/scanner/state";
import { titleCase, timeAgo } from "@/lib/format";

export async function ScannerCard({ ownerId }: { ownerId: string }) {
  const { state, schedule, targets } = await readScanner(ownerId);
  return (
    <Card data-testid="dashboard-scanner">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Scanner</CardTitle>
        <Link href="/scanner" className="text-sm text-blue-600 hover:underline">Open</Link>
      </CardHeader>
      <CardContent className="text-sm">
        <div className="font-medium">{titleCase(state.status)}</div>
        <div className="text-muted-foreground">{state.currentActivity ?? (schedule.enabled ? `${targets.length} target zip${targets.length === 1 ? "" : "s"}` : "Not enabled")}{state.lastTickAt ? ` · last tick ${timeAgo(state.lastTickAt)}` : ""}</div>
      </CardContent>
    </Card>
  );
}
