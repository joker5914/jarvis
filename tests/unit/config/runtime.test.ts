import { describe, it, expect } from "vitest";
import { mergeConfig, overridesSchema, salvageBySection, salvageOverrides } from "@/lib/config/runtime";
import { CATEGORIES } from "@/lib/config/categories";
import { DEFAULT_EXCLUSION_CONFIG } from "@/lib/config/exclusion";
import { ENRICH_CONFIG } from "@/lib/config/enrichment";

describe("mergeConfig", () => {
  it("returns defaults for empty overrides", () => {
    const c = mergeConfig({});
    expect(c.categories).toHaveLength(CATEGORIES.length);
    expect(c.exclusion.chains).toEqual(DEFAULT_EXCLUSION_CONFIG.chains);
    expect(c.exclusion.entityPatterns).toBe(DEFAULT_EXCLUSION_CONFIG.entityPatterns);
    expect(c.projects).toEqual({ highFitThreshold: 60, mediumFitThreshold: 30, backfillMonths: 12 });
    expect(c.enrichment).toEqual({
      maxPeople: 1,
      monthlyCreditCap: 80,
      cycleRenewsOn: null,
      metroLocation: null,
      chainHeadcountMin: ENRICH_CONFIG.chainHeadcountMin,
      preferredTitles: ENRICH_CONFIG.preferredTitles,
      seniorities: ENRICH_CONFIG.seniorities,
    });
  });
  it("replaces list fields wholesale, keeps entityPatterns, applies category disable and package override", () => {
    const c = mergeConfig({ exclusion: { chains: ["bella"] }, categories: { disabled: ["bar"], packageOverrides: { cafe: "internet_mobile" } }, projects: { highFitThreshold: 70 } });
    expect(c.exclusion.chains).toEqual(["bella"]);
    expect(c.exclusion.positiveKeywords).toEqual(DEFAULT_EXCLUSION_CONFIG.positiveKeywords);
    expect(c.categories.find((x) => x.slug === "bar")).toBeUndefined();
    expect(c.categories.find((x) => x.slug === "cafe")?.packageSlug).toBe("internet_mobile");
    expect(c.allCategories.find((x) => x.slug === "bar")).toMatchObject({ enabled: false });
    expect(c.projects.highFitThreshold).toBe(70);
    expect(c.projects.mediumFitThreshold).toBe(30);
  });
});

describe("overridesSchema", () => {
  it("normalizes strings and rejects bad values", () => {
    const ok = overridesSchema.parse({ exclusion: { chains: ["  Bella ", "", "H-E-B"] } });
    expect(ok.exclusion?.chains).toEqual(["bella", "h-e-b"]);
    expect(() => overridesSchema.parse({ projects: { highFitThreshold: 20, mediumFitThreshold: 30 } })).toThrow();
    expect(() => overridesSchema.parse({ categories: { packageOverrides: { cafe: "not_a_package" } } })).toThrow();
    expect(() => overridesSchema.parse({ categories: { disabled: ["nope"] } })).toThrow();
    expect(() => overridesSchema.parse({ bogus: 1 })).toThrow();
  });
  it("accepts a single package override without requiring every category slug (partial record, not exhaustive)", () => {
    const ok = overridesSchema.parse({ categories: { packageOverrides: { cafe: "internet_mobile" } } });
    expect(ok.categories?.packageOverrides).toEqual({ cafe: "internet_mobile" });
    expect(() => overridesSchema.parse({ categories: { packageOverrides: { nope: "internet_mobile" } } })).toThrow();
    expect(() => overridesSchema.parse({ categories: { packageOverrides: { cafe: "not_a_package" } } })).toThrow();
  });
  it("accepts valid enrichment overrides and rejects out-of-bounds/malformed ones", () => {
    const ok = overridesSchema.parse({ enrichment: { maxPeople: 2, monthlyCreditCap: 50, cycleRenewsOn: "2026-10-15" } });
    expect(ok.enrichment).toEqual({ maxPeople: 2, monthlyCreditCap: 50, cycleRenewsOn: "2026-10-15" });
    expect(() => overridesSchema.parse({ enrichment: { maxPeople: 6 } })).toThrow();
    expect(() => overridesSchema.parse({ enrichment: { cycleRenewsOn: "15 Oct" } })).toThrow();
  });
  it("raises the monthly credit cap ceiling to 5000", () => {
    const ok = overridesSchema.parse({ enrichment: { monthlyCreditCap: 5000 } });
    expect(ok.enrichment?.monthlyCreditCap).toBe(5000);
    expect(() => overridesSchema.parse({ enrichment: { monthlyCreditCap: 5001 } })).toThrow();
  });
  it("accepts a metro area string, defaults to null via mergeConfig, and rejects out-of-range lengths", () => {
    const ok = overridesSchema.parse({ enrichment: { metroLocation: "Houston, Texas" } });
    expect(ok.enrichment?.metroLocation).toBe("Houston, Texas");
    expect(mergeConfig({}).enrichment.metroLocation).toBeNull();
    expect(mergeConfig(ok).enrichment.metroLocation).toBe("Houston, Texas");
    expect(() => overridesSchema.parse({ enrichment: { metroLocation: "TX" } })).toThrow(); // shorter than min(3)
    expect(() => overridesSchema.parse({ enrichment: { metroLocation: "x".repeat(81) } })).toThrow(); // longer than max(80)
    expect(overridesSchema.parse({ enrichment: { metroLocation: null } }).enrichment?.metroLocation).toBeNull();
  });
});

describe("salvageOverrides", () => {
  it("passes a valid row through untouched", () => {
    const r = salvageOverrides({ projects: { highFitThreshold: 75 }, enrichment: { monthlyCreditCap: 1000 } });
    expect(r.dropped).toEqual([]);
    expect(r.overrides).toEqual({ projects: { highFitThreshold: 75 }, enrichment: { monthlyCreditCap: 1000 } });
  });

  // The Plan 9 production bug: `next start` was serving a build predating `enrichment.metroLocation`,
  // so its `.strict()` schema rejected the stored row and `loadConfig` reverted *every* setting to
  // defaults -- the user's monthlyCreditCap 1000 silently became 80. A key this build doesn't know
  // must cost only itself. `futureSetting` stands in for "written by a newer build".
  it("drops an unknown key inside a section and keeps its valid siblings", () => {
    const r = salvageOverrides({ enrichment: { monthlyCreditCap: 1000, futureSetting: "x" } });
    expect(r.overrides.enrichment?.monthlyCreditCap).toBe(1000);
    expect(r.dropped).toEqual(["enrichment.futureSetting"]);
  });

  it("drops an unknown top-level section and keeps the recognized ones", () => {
    const r = salvageOverrides({ futureSection: { a: 1 }, projects: { highFitThreshold: 75 } });
    expect(r.overrides.projects?.highFitThreshold).toBe(75);
    expect(r.dropped).toEqual(["futureSection"]);
  });

  it("drops only the offending leaf when a value is out of range", () => {
    const r = salvageOverrides({ enrichment: { maxPeople: 6, monthlyCreditCap: 1000 } });
    expect(r.overrides.enrichment).toEqual({ monthlyCreditCap: 1000 });
    expect(r.dropped).toEqual(["enrichment.maxPeople"]);
  });

  it("drops the whole section for a cross-field refine failure, but not unrelated sections", () => {
    const r = salvageOverrides({ projects: { highFitThreshold: 20, mediumFitThreshold: 30 }, exclusion: { chains: ["bella"] } });
    expect(r.overrides.projects).toBeUndefined();
    expect(r.overrides.exclusion?.chains).toEqual(["bella"]);
    expect(r.dropped).toEqual(["projects"]);
  });

  it("drops a bad array field rather than the section holding it", () => {
    const r = salvageOverrides({ exclusion: { chains: ["x".repeat(81)], costHardLimit: 5 } });
    expect(r.overrides.exclusion).toEqual({ costHardLimit: 5 });
    expect(r.dropped).toEqual(["exclusion.chains"]);
  });

  it("falls back to defaults when the row is not an object at all", () => {
    expect(salvageOverrides("nonsense")).toEqual({ overrides: {}, dropped: ["<root>"] });
    expect(salvageOverrides(null)).toEqual({ overrides: {}, dropped: ["<root>"] });
  });

  it("does not mutate the caller's object", () => {
    const raw = { enrichment: { monthlyCreditCap: 1000, futureSetting: "x" } };
    salvageOverrides(raw);
    expect(raw.enrichment.futureSetting).toBe("x");
  });

  // Post-merge audit finding B1: two zod issues in one pass naming the SAME field used to make
  // `dropAt` climb past an already-removed key and delete the whole parent section, losing valid
  // siblings. Each of these has two independently-failing entries in the same list/array.
  it("drops seniorities only once for two malformed elements in the same pass, keeping siblings", () => {
    const r = salvageOverrides({
      enrichment: { seniorities: ["C Suite", "V P"], monthlyCreditCap: 1000, maxPeople: 3 },
      projects: { highFitThreshold: 75 },
    });
    expect(r.overrides.enrichment?.seniorities).toBeUndefined();
    expect(r.overrides.enrichment?.monthlyCreditCap).toBe(1000);
    expect(r.overrides.enrichment?.maxPeople).toBe(3);
    expect(r.overrides.projects?.highFitThreshold).toBe(75);
    expect(r.dropped).toEqual(["enrichment.seniorities"]);
  });

  it("drops chains only once for two over-long entries in the same pass, keeping costHardLimit", () => {
    const r = salvageOverrides({
      exclusion: { chains: ["x".repeat(81), "y".repeat(81)], costHardLimit: 5 },
    });
    expect(r.overrides.exclusion).toEqual({ costHardLimit: 5 });
    expect(r.dropped).toEqual(["exclusion.chains"]);
  });

  it("drops chains only once for multiple wrong-typed elements in the same pass, keeping costHardLimit", () => {
    const r = salvageOverrides({
      exclusion: { chains: [1, { a: 2 }, "ok"], costHardLimit: 5 },
    });
    expect(r.overrides.exclusion).toEqual({ costHardLimit: 5 });
    expect(r.dropped).toEqual(["exclusion.chains"]);
  });

  it("drops only a scalar-typed section, not the rest of the row", () => {
    const r = salvageOverrides({ enrichment: "nope", projects: { highFitThreshold: 75 } });
    expect(r.overrides.enrichment).toBeUndefined();
    expect(r.overrides.projects?.highFitThreshold).toBe(75);
    expect(r.dropped).toEqual(["enrichment"]);
  });

  it("drops two bad fields in different sections independently, leaving both sections intact", () => {
    const r = salvageOverrides({
      enrichment: { seniorities: ["C Suite"], monthlyCreditCap: 1000 },
      exclusion: { chains: ["x".repeat(81)], costHardLimit: 5 },
    });
    expect(r.overrides.enrichment).toEqual({ monthlyCreditCap: 1000 });
    expect(r.overrides.exclusion).toEqual({ costHardLimit: 5 });
    expect(r.dropped.sort()).toEqual(["enrichment.seniorities", "exclusion.chains"]);
  });
});

describe("targeting overrides (chainHeadcountMin, preferredTitles, seniorities)", () => {
  it("defaults all three to ENRICH_CONFIG when unset", () => {
    const e = mergeConfig({}).enrichment;
    expect(e.chainHeadcountMin).toBe(ENRICH_CONFIG.chainHeadcountMin);
    expect(e.preferredTitles).toEqual(ENRICH_CONFIG.preferredTitles);
    expect(e.seniorities).toEqual(ENRICH_CONFIG.seniorities);
  });

  it("accepts an override for each and merges it over the default", () => {
    const o = overridesSchema.parse({
      enrichment: { chainHeadcountMin: 250, preferredTitles: ["Owner", "  Principal "], seniorities: ["owner", "c_suite"] },
    });
    // preferredTitles reuses the exclusion word-list normalizer: trimmed and lowercased.
    expect(o.enrichment?.preferredTitles).toEqual(["owner", "principal"]);
    const e = mergeConfig(o).enrichment;
    expect(e.chainHeadcountMin).toBe(250);
    expect(e.preferredTitles).toEqual(["owner", "principal"]);
    expect(e.seniorities).toEqual(["owner", "c_suite"]);
  });

  // An empty title/seniority list would drop the filter from the Apollo query entirely, so the
  // search would match every employee and the chain threshold would be counting a different
  // population than it was calibrated against. Refuse it rather than silently widen targeting.
  it("refuses an empty title or seniority list, naming the field in the message", () => {
    expect(() => overridesSchema.parse({ enrichment: { preferredTitles: [] } })).toThrow();
    expect(() => overridesSchema.parse({ enrichment: { seniorities: [] } })).toThrow();
    expect(() => overridesSchema.parse({ enrichment: { preferredTitles: ["  ", ""] } })).toThrow();
    const titles = overridesSchema.safeParse({ enrichment: { preferredTitles: [] } });
    expect(titles.success).toBe(false);
    if (!titles.success) expect(titles.error.issues[0].message).toBe("Titles: must list at least one entry");
    const seniorities = overridesSchema.safeParse({ enrichment: { seniorities: [] } });
    expect(seniorities.success).toBe(false);
    if (!seniorities.success) expect(seniorities.error.issues[0].message).toBe("Seniorities: must list at least one entry");
  });

  it("refuses a seniority that is not an Apollo-shaped token", () => {
    // Apollo's person_seniorities values are snake_case tokens ("c_suite"); a space means the
    // operator typed a label ("C Suite") that Apollo would silently match nothing for.
    expect(() => overridesSchema.parse({ enrichment: { seniorities: ["C Suite"] } })).toThrow();
    expect(overridesSchema.parse({ enrichment: { seniorities: ["C_Suite"] } }).enrichment?.seniorities).toEqual(["c_suite"]);
  });

  it("bounds chainHeadcountMin", () => {
    expect(() => overridesSchema.parse({ enrichment: { chainHeadcountMin: 0 } })).toThrow();
    expect(() => overridesSchema.parse({ enrichment: { chainHeadcountMin: 1.5 } })).toThrow();
    expect(() => overridesSchema.parse({ enrichment: { chainHeadcountMin: ENRICH_CONFIG.chainHeadcountMinMax + 1 } })).toThrow();
    expect(overridesSchema.parse({ enrichment: { chainHeadcountMin: 1 } }).enrichment?.chainHeadcountMin).toBe(1);
  });
});

describe("salvageBySection fallback keeps independently valid sections", () => {
  it("drops only the broken section and names it", () => {
    const r = salvageBySection({ enrichment: { monthlyCreditCap: 1000 }, exclusion: { costHardLimit: -5 } }, []);
    expect(r.overrides).toEqual({ enrichment: { monthlyCreditCap: 1000 } });
    expect(r.dropped).toEqual(["exclusion"]);
  });
  it("names every broken section", () => {
    const r = salvageBySection({ enrichment: "nope", exclusion: { costHardLimit: -5 }, projects: { highFitThreshold: 75 } }, ["x"]);
    expect(r.overrides).toEqual({ projects: { highFitThreshold: 75 } });
    expect(r.dropped).toEqual(["x", "enrichment", "exclusion"]);
  });
});
