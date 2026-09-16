import { describe, it, expect } from "vitest";
import { mergeConfig, overridesSchema } from "@/lib/config/runtime";
import { CATEGORIES } from "@/lib/config/categories";
import { DEFAULT_EXCLUSION_CONFIG } from "@/lib/config/exclusion";

describe("mergeConfig", () => {
  it("returns defaults for empty overrides", () => {
    const c = mergeConfig({});
    expect(c.categories).toHaveLength(CATEGORIES.length);
    expect(c.exclusion.chains).toEqual(DEFAULT_EXCLUSION_CONFIG.chains);
    expect(c.exclusion.entityPatterns).toBe(DEFAULT_EXCLUSION_CONFIG.entityPatterns);
    expect(c.projects).toEqual({ highFitThreshold: 60, mediumFitThreshold: 30, backfillMonths: 12 });
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
});
