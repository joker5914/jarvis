import { Badge } from "@/components/ui/badge";

const STYLES: Record<string, string> = {
  opening_soon: "bg-emerald-100 text-emerald-800",
  under_construction: "bg-blue-100 text-blue-800",
  planned: "bg-neutral-200 text-neutral-800",
  just_completed: "bg-amber-100 text-amber-800",
  stale: "bg-neutral-100 text-neutral-500",
};
const LABELS: Record<string, string> = {
  opening_soon: "Opening soon",
  under_construction: "Under construction",
  planned: "Planned",
  just_completed: "Just completed",
  stale: "Stale",
};

export function TimingBadge({ window }: { window: string | null | undefined }) {
  if (!window) return <span className="text-xs text-neutral-400">—</span>;
  return <Badge className={`${STYLES[window] ?? ""} border-0`}>{LABELS[window] ?? window}</Badge>;
}
