import { Badge } from "@/components/ui/badge";
import { bandFor, type SmbFitThresholds } from "@/lib/scoring/smbFit";

const STYLES = {
  high: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  medium: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  low: "bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
} as const;

/**
 * `thresholds` is optional and falls back to `bandFor`'s own default (the static
 * `PROJECT_CONFIG`) so pure/legacy call sites keep compiling; pages that load an owner's
 * `RuntimeConfig` should pass `cfg.projects` through so the badge matches the same
 * thresholds the API used to compute `fit=high|medium|low` filtering.
 */
export function FitBadge({ score, excluded, thresholds }: { score: number; excluded?: boolean; thresholds?: SmbFitThresholds }) {
  if (excluded) return <Badge className="border-0 bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300">Excluded</Badge>;
  const band = bandFor(score, thresholds);
  return (
    <Badge className={`${STYLES[band]} border-0 capitalize`} title={`SMB fit ${score}`}>
      {band} · {score}
    </Badge>
  );
}
