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
        /** Operator-typed metro area (e.g. "Houston, Texas") passed verbatim as a
         * `person_locations[]` value when the location cascade's city scope is empty or skipped —
         * see PeopleSearchQuery.metro and ApolloEnrichmentProvider.searchPeople. Not prefilled;
         * null (the default) means the metro scope is skipped entirely. */
        metroLocation: z.string().trim().min(3).max(80).nullable().optional(),
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
  enrichment: { maxPeople: number; monthlyCreditCap: number; cycleRenewsOn: string | null; metroLocation: string | null };
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
      metroLocation: o.enrichment?.metroLocation ?? null,
    },
    overrides: o,
  };
}

/** Walk `path` from `root`, returning the object/array it lands on, or null if the path is absent
 * or lands on a scalar. */
function nodeAt(root: object, path: readonly PropertyKey[]): Record<PropertyKey, unknown> | null {
  let node: unknown = root;
  for (const key of path) {
    if (node === null || typeof node !== "object") return null;
    node = (node as Record<PropertyKey, unknown>)[key];
  }
  return node !== null && typeof node === "object" ? (node as Record<PropertyKey, unknown>) : null;
}

/** Delete the narrowest thing that owns a failing `issue.path`: normally the offending leaf field,
 * but for an issue on an array *element* (or on a whole section, as a cross-field `.refine()`
 * reports) the containing field, since deleting an element would leave a hole that fails again.
 * Returns the dotted path actually removed, or null if there was nothing to remove. */
function dropAt(root: object, path: readonly PropertyKey[]): string | null {
  for (let end = path.length; end >= 1; end--) {
    const parent = nodeAt(root, path.slice(0, end - 1));
    if (!parent || Array.isArray(parent)) continue;
    const key = path[end - 1];
    if (key in parent) {
      delete parent[key];
      return path.slice(0, end).join(".");
    }
  }
  return null;
}

/**
 * Read path for a stored `AppConfig.overrides` row: salvage everything that still validates
 * instead of discarding the row wholesale.
 *
 * A row is written by whichever build was deployed at the time, so a running server can meet keys
 * its own `.strict()` schema doesn't know. That is not hypothetical: a `next start` serving a build
 * that predated `enrichment.metroLocation` rejected the whole row over that one key and reverted
 * *every* setting to its default -- the operator's `monthlyCreditCap: 1000` silently became 80,
 * with only a "[config] ignoring invalid overrides" line to show for it. An unrecognized or
 * malformed entry must cost only itself.
 *
 * Writes deliberately keep using `overridesSchema` directly (see `saveOverrides`), so the Settings
 * API still rejects a typo'd key outright rather than quietly swallowing it.
 */
export function salvageOverrides(raw: unknown): { overrides: ConfigOverrides; dropped: string[] } {
  const first = overridesSchema.safeParse(raw);
  if (first.success) return { overrides: first.data, dropped: [] };
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return { overrides: {}, dropped: ["<root>"] };

  const candidate = structuredClone(raw) as Record<PropertyKey, unknown>;
  const dropped: string[] = [];

  // Each pass removes at least one key, so the row converges; the bound is a guard against a
  // pathological row, not an expected exit. Unrecognized keys go first and are handled separately
  // because zod reports them as one issue *per object* (`path` = the object, `keys` = its unknown
  // entries), unlike a value error whose `path` points at the value itself.
  for (let pass = 0; pass < 20; pass++) {
    const r = overridesSchema.safeParse(candidate);
    if (r.success) return { overrides: r.data, dropped };

    const unknowns = r.error.issues.filter((i) => i.code === "unrecognized_keys");
    let removed = false;
    for (const issue of unknowns) {
      const parent = nodeAt(candidate, issue.path);
      if (!parent) continue;
      for (const key of issue.keys) {
        if (!(key in parent)) continue;
        delete parent[key];
        dropped.push([...issue.path, key].join("."));
        removed = true;
      }
    }
    if (removed) continue;

    // Whatever is left is a real validation failure, so drop what owns it.
    for (const issue of r.error.issues) {
      if (issue.path.length === 0) return { overrides: {}, dropped: [...dropped, "<root>"] };
      const gone = dropAt(candidate, issue.path);
      if (gone) {
        dropped.push(gone);
        removed = true;
      }
    }
    if (!removed) return { overrides: {}, dropped: [...dropped, "<root>"] };
  }
  return { overrides: {}, dropped: [...dropped, "<root>"] };
}

export async function loadConfig(ownerId: string): Promise<RuntimeConfig> {
  const row = await prisma.appConfig.findUnique({ where: { ownerId } });
  if (!row) return mergeConfig({});
  const { overrides, dropped } = salvageOverrides(row.overrides);
  if (dropped.length > 0) {
    // Name exactly what was lost and say the rest survived -- the old wording ("ignoring invalid
    // overrides") read as if one key had been skipped while in fact every setting had been reset.
    console.warn(`[config] dropped unusable AppConfig entries for ${ownerId}, other settings still apply: ${dropped.join(", ")}`);
  }
  return mergeConfig(overrides);
}

export async function saveOverrides(ownerId: string, overrides: unknown): Promise<RuntimeConfig> {
  const o = overridesSchema.parse(overrides);
  await prisma.appConfig.upsert({ where: { ownerId }, update: { overrides: o }, create: { ownerId, overrides: o } });
  return mergeConfig(o);
}
