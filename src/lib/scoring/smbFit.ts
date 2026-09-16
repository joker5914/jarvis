import { DEFAULT_EXCLUSION_CONFIG, type ExclusionConfig } from "@/lib/config/exclusion";
import type { ScoreReason, SmbWorkType } from "./types";

export type SmbFitInput = {
  name: string;
  facilityName?: string | null;
  estimatedCost?: number | null;
  squareFootage?: number | null;
  tenantFunded?: boolean | null;
  workType?: SmbWorkType | null;
  sameNameCount?: number | null;
};

export type SmbFitBand = "high" | "medium" | "low";

export type SmbFitResult = {
  excluded: boolean;
  exclusionReasons: string[];
  score: number;
  band: SmbFitBand;
  reasons: ScoreReason[];
};

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasWord(text: string, kw: string) {
  return new RegExp(`\\b${escapeRe(kw)}\\b`, "i").test(text);
}

export function bandFor(score: number): SmbFitBand {
  if (score >= 60) return "high";
  if (score >= 30) return "medium";
  return "low";
}

export function scoreSmbFit(
  input: SmbFitInput,
  config: ExclusionConfig = DEFAULT_EXCLUSION_CONFIG,
): SmbFitResult {
  const text = [input.name, input.facilityName ?? ""].join(" ").toLowerCase();
  const exclusionReasons: string[] = [];

  const chain = config.chains.find((c) => text.includes(c));
  if (chain) exclusionReasons.push(`chain:${chain.trim()}`);
  const entity = config.entityPatterns.find((p) => p.test(text));
  if (entity) exclusionReasons.push(`entity:${entity.source}`);
  if (input.estimatedCost != null && input.estimatedCost > config.costHardLimit) {
    exclusionReasons.push(`cost_over_${config.costHardLimit}`);
  }
  if (input.workType === "row") exclusionReasons.push("public_right_of_way");
  if (input.sameNameCount != null && input.sameNameCount > config.sameNameLimit) {
    exclusionReasons.push(`same_name_count:${input.sameNameCount}`);
  }
  if (exclusionReasons.length > 0) {
    return { excluded: true, exclusionReasons, score: 0, band: "low", reasons: [] };
  }

  const reasons: ScoreReason[] = [];
  let score = 0;
  const add = (code: string, points: number, detail: string) => {
    reasons.push({ code, points, detail });
    score += points;
  };

  const kw = config.positiveKeywords.find((k) => hasWord(text, k));
  if (kw) add("positive_keyword", 25, `name contains "${kw}"`);
  if (input.tenantFunded) add("tenant_funded", 25, "tenant-funded build-out");
  if (input.squareFootage != null) {
    if (input.squareFootage < 5_000) add("sqft_under_5k", 15, `${input.squareFootage} sq ft`);
    else if (input.squareFootage < 10_000) add("sqft_under_10k", 5, `${input.squareFootage} sq ft`);
  }
  if (input.estimatedCost != null) {
    if (input.estimatedCost < 250_000) add("cost_under_250k", 20, `$${input.estimatedCost}`);
    else if (input.estimatedCost < 750_000) add("cost_under_750k", 10, `$${input.estimatedCost}`);
  }
  if (input.workType === "renovation") add("work_type", 10, "renovation/alteration");
  else if (input.workType === "new_construction") add("work_type", 5, "new construction");
  for (const neg of config.softNegativeKeywords) {
    if (text.includes(neg)) add("soft_negative", -30, `name contains "${neg}"`);
  }

  score = Math.max(0, Math.min(100, score));
  return { excluded: false, exclusionReasons: [], score, band: bandFor(score), reasons };
}
