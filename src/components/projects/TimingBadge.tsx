import { Badge } from "@/components/ui/badge";

const STYLES: Record<string, string> = {
  opening_soon: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  under_construction: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  planned: "bg-neutral-200 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-300",
  just_completed: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  stale: "bg-neutral-100 text-muted-foreground dark:bg-neutral-800",
};
const LABELS: Record<string, string> = {
  opening_soon: "Opening soon",
  under_construction: "Under construction",
  planned: "Planned",
  just_completed: "Just completed",
  stale: "Stale",
};

export function TimingBadge({ window }: { window: string | null | undefined }) {
  if (!window) return <span className="text-xs text-muted-foreground">—</span>;
  return <Badge className={`${STYLES[window] ?? ""} border-0`}>{LABELS[window] ?? window}</Badge>;
}
