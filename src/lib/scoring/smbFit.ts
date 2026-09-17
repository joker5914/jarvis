import { DEFAULT_EXCLUSION_CONFIG, type ExclusionConfig } from "@/lib/config/exclusion";
import { PROJECT_CONFIG } from "@/lib/config/projects";
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

// Exported (fix round, review B2): tests assert hasWord(name, chainKeyFor(name)) directly, and
// the route that builds chain-list entries needs the exact matching semantics scoreSmbFit uses.
export function hasWord(text: string, kw: string) {
  return new RegExp(`\\b${escapeRe(kw)}\\b`, "i").test(text);
}

// A trailing legal-entity suffix only — "Zumiez LLC" -> strip " llc", but "Chick-fil-A Pearland"
// keeps "pearland" (it isn't a legal suffix). Mirrors the suffix list in
// src/lib/jobs/shared.ts's normalizeName, but trailing-only and case-insensitive on a
// whitespace-collapsed string rather than global-replace, since chainKeyFor must NOT touch
// internal punctuation (see the doc comment below for why).
const TRAILING_LEGAL_SUFFIX_RE = /\b(?:llc|inc|co|corp|ltd|pllc|pc)\.?$/i;

/**
 * Fix round (review B2): the chain-list entry the "Not an SMB" PATCH action persists for a
 * business's own name. `normalizeName` (src/lib/jobs/shared.ts) is the wrong tool here — it
 * strips `&`, `'`, `-`, and `.`, so "H&R Block" would normalize to "h r block", which `hasWord`
 * can never match against the raw (punctuation-intact) lowercase name `scoreSmbFit` actually
 * scores against. `chainKeyFor` instead only lowercases, trims, collapses internal whitespace, and
 * strips a trailing legal-entity suffix — every other character (including `&`, `'`, `-`) survives
 * intact, so `hasWord(name.toLowerCase(), chainKeyFor(name))` is always true for the name it was
 * built from.
 */
export function chainKeyFor(name: string): string {
  const collapsed = name.trim().replace(/\s+/g, " ").toLowerCase();
  // Also trim leading/trailing non-alphanumerics ("Pet Paradise (Pearland)", "Joe's Diner!"):
  // hasWord's  needs a word character at both ends of the pattern, so a key that starts or ends
  // with punctuation could never match its own name. Internal punctuation stays.
  return collapsed.replace(TRAILING_LEGAL_SUFFIX_RE, "").trim().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
}

export type SmbFitThresholds = { highFitThreshold: number; mediumFitThreshold: number };

export function bandFor(score: number, t: SmbFitThresholds = PROJECT_CONFIG): SmbFitBand {
  if (score >= t.highFitThreshold) return "high";
  if (score >= t.mediumFitThreshold) return "medium";
  return "low";
}

export function scoreSmbFit(
  input: SmbFitInput,
  config: ExclusionConfig = DEFAULT_EXCLUSION_CONFIG,
  thresholds?: SmbFitThresholds,
): SmbFitResult {
  const text = [input.name, input.facilityName ?? ""].join(" ").toLowerCase();
  const exclusionReasons: string[] = [];

  const chain = config.chains.find((c) => hasWord(text, c.trim()));
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
    if (hasWord(text, neg.trim())) add("soft_negative", -30, `name contains "${neg}"`);
  }

  score = Math.max(0, Math.min(100, score));
  return { excluded: false, exclusionReasons: [], score, band: bandFor(score, thresholds), reasons };
}
