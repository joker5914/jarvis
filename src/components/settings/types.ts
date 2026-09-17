import type { PackageSlug } from "@/lib/config/packages";

export type ProviderEntry = {
  provider: "google" | "apollo";
  label: string;
  source: "env" | "stored" | "none";
  /** True when a ProviderConfig row has an encryptedKey, regardless of `source` (env still wins). */
  hasStoredKey: boolean;
  enabled: boolean;
  dailyBudget: number;
  usedToday: number;
};

export type PackageOption = { slug: PackageSlug; label: string };

export type CategoryEntry = {
  slug: string;
  label: string;
  enabled: boolean;
  packageSlug: PackageSlug;
  defaultPackageSlug: PackageSlug;
};

export type ExclusionConfig = {
  chains: string[];
  positiveKeywords: string[];
  softNegativeKeywords: string[];
  costHardLimit: number;
  sameNameLimit: number;
};

export type ProjectsConfig = {
  highFitThreshold: number;
  mediumFitThreshold: number;
  backfillMonths: number;
};

export type EnrichmentConfig = {
  maxPeople: number;
  monthlyCreditCap: number;
  cycleRenewsOn: string | null;
  /** Operator-typed metro area (e.g. "Houston, Texas"), used by the location cascade's metro
   * scope when the lead's own city scope is empty or skipped. Not prefilled; null by default. */
  metroLocation: string | null;
};

export type CreditStatus = {
  used: number;
  cap: number;
  remaining: number;
  cycleStart: string;
  /** Apollo's own account-wide balance and cycle end (ISO date), or null when unavailable. */
  apollo: { limit: number; consumed: number; leftOver: number; cycleEnd: string } | null;
};

export type SettingsPayload = {
  providers: ProviderEntry[];
  config: { exclusion: ExclusionConfig; categories: CategoryEntry[]; projects: ProjectsConfig; enrichment: EnrichmentConfig };
  credits: CreditStatus;
  packages: PackageOption[];
  defaults: { exclusion: ExclusionConfig; projects: ProjectsConfig; enrichment: EnrichmentConfig };
};
