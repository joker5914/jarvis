import { Badge } from "@/components/ui/badge";

const STYLES: Record<string, string> = {
  queued: "bg-neutral-200 text-neutral-800",
  running: "bg-blue-100 text-blue-800",
  paused: "bg-amber-100 text-amber-800",
  complete: "bg-emerald-100 text-emerald-800",
  failed: "bg-red-100 text-red-800",
};

export function SearchStatusBadge({ status }: { status: string }) {
  return <Badge className={`${STYLES[status] ?? ""} border-0 capitalize`}>{status}</Badge>;
}
