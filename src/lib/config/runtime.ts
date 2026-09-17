import { z } from "zod";
import { prisma } from "@/lib/db";
import { CATEGORIES, type Category } from "./categories";
import { DEFAULT_EXCLUSION_CONFIG, type ExclusionConfig } from "./exclusion";
import { ENRICH_CONFIG } from "./enrichment";
import { PACKAGES, type PackageSlug } from "./packages";
import { PROJECT_CONFIG } from "./projects";

const PACKAGE_SLUGS = PACKAGES.map((p) => p.slug) as [PackageSlug, ...PackageSlug[]];
const CATEGORY_SLUGS = CATEGORIES.map((c) => c.slug) as [string, ...string[]];
const wordList = z
  .array(z.string().transform((s) => s.trim().toLowerCase()))
  .transform((a) => a.filter(Boolean))
  .pipe(z.array(z.string().max(80)).max(500));

export const overridesSchema = z
  .object({
    exclusion: z
      .object({
        chains: wordList.optional(),
        positiveKeywords: wordList.optional(),
        softNegativeKeywords: wordList.optional(),
        costHardLimit: z.number().int().min(0).optional(),
        sameNameLimit: z.number().int().min(1).max(100).optional(),
      })
      .strict()
      .optional(),
    categories: z
      .object({
        disabled: z.array(z.enum(CATEGORY_SLUGS)).optional(),
        packageOverrides: z.partialRecord(z.enum(CATEGORY_SLUGS), z.enum(PACKAGE_SLUGS)).optional(),
      })
      .strict()
      .optional(),
    projects: z
      .object({
        highFitThreshold: z.number().int().min(0).max(100).optional(),
        mediumFitThreshold: z.number().int().min(0).max(100).optional(),
        backfillMonths: z.number().int().min(1).max(36).optional(),
      })
      .strict()
      .refine((p) => (p.highFitThreshold ?? PROJECT_CONFIG.highFitThreshold) > (p.mediumFitThreshold ?? PROJECT_CONFIG.mediumFitThreshold), {
        message: "highFitThreshold must be greater than mediumFitThreshold",
      })
      .optional(),
    enrichment: z
      .object({
        maxPeople: z.number().int().min(1).max(ENRICH_CONFIG.maxPeopleLimit).optional(),
        monthlyCreditCap: z.number().int().min(0).max(ENRICH_CONFIG.monthlyCreditCapMax).optional(),
        cycleRenewsOn: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullable()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type ConfigOverrides = z.infer<typeof overridesSchema>;

export type RuntimeConfig = {
  exclusion: ExclusionConfig;
  categories: Category[];
  allCategories: (Category & { enabled: boolean; defaultPackageSlug: PackageSlug })[];
  projects: { highFitThreshold: number; mediumFitThreshold: number; backfillMonths: number };
  enrichment: { maxPeople: number; monthlyCreditCap: number; cycleRenewsOn: string | null };
  overrides: ConfigOverrides;
};

export function mergeConfig(o: ConfigOverrides): RuntimeConfig {
  const disabled = new Set(o.categories?.disabled ?? []);
  const pk = o.categories?.packageOverrides ?? {};
  const allCategories = CATEGORIES.map((c) => ({
    ...c,
    defaultPackageSlug: c.packageSlug,
    packageSlug: pk[c.slug] ?? c.packageSlug,
    enabled: !disabled.has(c.slug),
  }));
  return {
    exclusion: { ...DEFAULT_EXCLUSION_CONFIG, ...(o.exclusion ?? {}), entityPatterns: DEFAULT_EXCLUSION_CONFIG.entityPatterns },
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- strip the enabled/defaultPackageSlug helper fields, keep the Category shape
    categories: allCategories.filter((c) => c.enabled).map(({ enabled, defaultPackageSlug, ...c }) => c),
    allCategories,
    projects: {
      highFitThreshold: o.projects?.highFitThreshold ?? PROJECT_CONFIG.highFitThreshold,
      mediumFitThreshold: o.projects?.mediumFitThreshold ?? PROJECT_CONFIG.mediumFitThreshold,
      backfillMonths: o.projects?.backfillMonths ?? PROJECT_CONFIG.backfillMonths,
    },
    enrichment: {
      maxPeople: o.enrichment?.maxPeople ?? ENRICH_CONFIG.maxPeople,
      monthlyCreditCap: o.enrichment?.monthlyCreditCap ?? ENRICH_CONFIG.monthlyCreditCapDefault,
      cycleRenewsOn: o.enrichment?.cycleRenewsOn ?? null,
    },
    overrides: o,
  };
}

export async function loadConfig(ownerId: string): Promise<RuntimeConfig> {
  const row = await prisma.appConfig.findUnique({ where: { ownerId } });
  if (!row) return mergeConfig({});
  const parsed = overridesSchema.safeParse(row.overrides);
  if (!parsed.success) {
    console.warn(`[config] ignoring invalid AppConfig overrides for ${ownerId}: ${parsed.error.message}`);
    return mergeConfig({});
  }
  return mergeConfig(parsed.data);
}

export async function saveOverrides(ownerId: string, overrides: unknown): Promise<RuntimeConfig> {
  const o = overridesSchema.parse(overrides);
  await prisma.appConfig.upsert({ where: { ownerId }, update: { overrides: o }, create: { ownerId, overrides: o } });
  return mergeConfig(o);
}
