import { z } from "zod";
import { prisma } from "@/lib/db";
import { CATEGORIES, type Category } from "./categories";
import { DEFAULT_EXCLUSION_CONFIG, type ExclusionConfig } from "./exclusion";
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
  })
  .strict();

export type ConfigOverrides = z.infer<typeof overridesSchema>;

export type RuntimeConfig = {
  exclusion: ExclusionConfig;
  categories: Category[];
  allCategories: (Category & { enabled: boolean; defaultPackageSlug: PackageSlug })[];
  projects: { highFitThreshold: number; mediumFitThreshold: number; backfillMonths: number };
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
