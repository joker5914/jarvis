import { DEFAULT_EXCLUSION_CONFIG, type ExclusionConfig } from "@/lib/config/exclusion";
import { bandFor, scoreSmbFit, type SmbFitBand, type SmbFitThresholds } from "@/lib/scoring/smbFit";
import type { ScoreReason, SmbWorkType } from "@/lib/scoring/types";
import { timingWindowFor, type TimingWindowValue } from "./timingWindow";

export type ProjectScoringInput = {
  projectName: string;
  facilityName: string | null;
  estimatedCost: number | null;
  squareFootage: number | null;
  tenantFunded: boolean | null;
  workType: SmbWorkType | null;
  startDate: Date | null;
  completionDate: Date | null;
  statusCode: number | null;
};

export type ProjectScoring = {
  smbFitScore: number;
  smbFitBand: SmbFitBand;
  smbFitReasons: ScoreReason[];
  exclusion: "none" | "enterprise";
  exclusionReasons: string[];
  timingWindow: TimingWindowValue | null;
};

export function scoreProjectFields(
  f: ProjectScoringInput,
  now: Date = new Date(),
  exclusionConfig: ExclusionConfig = DEFAULT_EXCLUSION_CONFIG,
  thresholds?: SmbFitThresholds,
): ProjectScoring {
  const fit = scoreSmbFit(
    {
      name: f.projectName,
      facilityName: f.facilityName,
      estimatedCost: f.estimatedCost,
      squareFootage: f.squareFootage,
      tenantFunded: f.tenantFunded,
      workType: f.workType,
    },
    exclusionConfig,
    thresholds,
  );
  return {
    smbFitScore: fit.score,
    smbFitBand: bandFor(fit.score, thresholds),
    smbFitReasons: fit.reasons,
    exclusion: fit.excluded ? "enterprise" : "none",
    exclusionReasons: fit.exclusionReasons,
    timingWindow: timingWindowFor({ startDate: f.startDate, completionDate: f.completionDate, statusCode: f.statusCode }, now),
  };
}
