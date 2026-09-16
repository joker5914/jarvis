import { Badge } from "@/components/ui/badge";
import { titleCase } from "@/lib/format";

const STYLES: Record<string, string> = {
  not_contacted: "bg-neutral-200 text-neutral-800",
  contacted: "bg-blue-100 text-blue-800",
  interested: "bg-emerald-100 text-emerald-800",
  not_a_fit: "bg-neutral-100 text-neutral-500 line-through",
  customer: "bg-purple-100 text-purple-800",
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge className={`${STYLES[status] ?? ""} border-0`}>{titleCase(status)}</Badge>;
}
