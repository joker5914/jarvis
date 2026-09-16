import { JobStatus } from "@prisma/client";
import { Badge } from "@/components/ui/badge";

const STYLES: Record<string, string> = {
  queued: "bg-neutral-200 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-300",
  running: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  paused: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  complete: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  failed: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
};

export function SearchStatusBadge({ status }: { status: JobStatus }) {
  return <Badge className={`${STYLES[status] ?? ""} border-0 capitalize`}>{status}</Badge>;
}
