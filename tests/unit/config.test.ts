import { describe, it, expect } from "vitest";
import { CATEGORIES } from "@/lib/config/categories";
import { PACKAGES, PRODUCTS } from "@/lib/config/packages";
import { DEFAULT_EXCLUSION_CONFIG } from "@/lib/config/exclusion";

describe("config defaults", () => {
  it("has unique category slugs and a known package for each", () => {
    const slugs = CATEGORIES.map((c) => c.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    const packageSlugs = new Set(PACKAGES.map((p) => p.slug));
    for (const c of CATEGORIES) expect(packageSlugs.has(c.packageSlug)).toBe(true);
    expect(CATEGORIES.length).toBeGreaterThanOrEqual(30);
  });

  it("defines the seven product slugs", () => {
    expect(PRODUCTS.map((p) => p.slug)).toEqual([
      "internet",
      "mobile",
      "voice",
      "tv",
      "security",
      "wifi_pro",
      "other",
    ]);
  });

  it("has sane exclusion thresholds", () => {
    expect(DEFAULT_EXCLUSION_CONFIG.costHardLimit).toBe(2_000_000);
    expect(DEFAULT_EXCLUSION_CONFIG.sameNameLimit).toBe(5);
    expect(DEFAULT_EXCLUSION_CONFIG.chains).toContain("walmart");
  });
});
