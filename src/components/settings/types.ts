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

export type SettingsPayload = {
  providers: ProviderEntry[];
  config: { exclusion: ExclusionConfig; categories: CategoryEntry[]; projects: ProjectsConfig };
  packages: PackageOption[];
  defaults: { exclusion: ExclusionConfig; projects: ProjectsConfig };
};
