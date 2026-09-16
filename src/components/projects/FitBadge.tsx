import { Badge } from "@/components/ui/badge";
import { bandFor } from "@/lib/scoring/smbFit";

const STYLES = { high: "bg-emerald-100 text-emerald-800", medium: "bg-amber-100 text-amber-800", low: "bg-neutral-200 text-neutral-700" } as const;

export function FitBadge({ score, excluded }: { score: number; excluded?: boolean }) {
  if (excluded) return <Badge className="border-0 bg-red-100 text-red-800">Excluded</Badge>;
  const band = bandFor(score);
  return (
    <Badge className={`${STYLES[band]} border-0 capitalize`} title={`SMB fit ${score}`}>
      {band} · {score}
    </Badge>
  );
}
