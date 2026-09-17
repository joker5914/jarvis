import { describe, it, expect } from "vitest";
import { mergeConfig, overridesSchema, salvageOverrides } from "@/lib/config/runtime";
import { CATEGORIES } from "@/lib/config/categories";
import { DEFAULT_EXCLUSION_CONFIG } from "@/lib/config/exclusion";

describe("mergeConfig", () => {
  it("returns defaults for empty overrides", () => {
    const c = mergeConfig({});
    expect(c.categories).toHaveLength(CATEGORIES.length);
    expect(c.exclusion.chains).toEqual(DEFAULT_EXCLUSION_CONFIG.chains);
    expect(c.exclusion.entityPatterns).toBe(DEFAULT_EXCLUSION_CONFIG.entityPatterns);
    expect(c.projects).toEqual({ highFitThreshold: 60, mediumFitThreshold: 30, backfillMonths: 12 });
    expect(c.enrichment).toEqual({ maxPeople: 1, monthlyCreditCap: 80, cycleRenewsOn: null, metroLocation: null });
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
});
