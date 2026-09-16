import { Badge } from "@/components/ui/badge";

const STYLES = {
  green: "bg-emerald-100 text-emerald-800",
  yellow: "bg-amber-100 text-amber-800",
  red: "bg-red-100 text-red-800",
} as const;

export function QualityBadge({ band, score }: { band: keyof typeof STYLES; score?: number }) {
  return (
    <Badge className={`${STYLES[band]} border-0 capitalize`} title={score != null ? `Score ${score}` : undefined}>
      <span className="mr-1 inline-block h-2 w-2 rounded-full bg-current" />
      {band}
    </Badge>
  );
}
