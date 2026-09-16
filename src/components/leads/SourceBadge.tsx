import { Badge } from "@/components/ui/badge";

const LABELS: Record<string, string> = { zip_search: "Zip search", tdlr: "TDLR", manual: "Manual", google: "Google", website: "Website", apollo: "Apollo" };

export function SourceBadge({ source }: { source: string }) {
  return <Badge variant="outline">{LABELS[source] ?? source}</Badge>;
}
