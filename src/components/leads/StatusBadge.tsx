import { Badge } from "@/components/ui/badge";
import { titleCase } from "@/lib/format";

const STYLES: Record<string, string> = {
  not_contacted: "bg-neutral-200 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-300",
  contacted: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  interested: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  not_a_fit: "bg-neutral-100 text-muted-foreground line-through dark:bg-neutral-800",
  customer: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300",
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge className={`${STYLES[status] ?? ""} border-0`}>{titleCase(status)}</Badge>;
}
