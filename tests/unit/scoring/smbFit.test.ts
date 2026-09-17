import { describe, it, expect } from "vitest";
import { bandFor, scoreSmbFit } from "@/lib/scoring/smbFit";

describe("bandFor", () => {
  it("uses the default (static) thresholds when none are passed", () => {
    expect(bandFor(65)).toBe("high");
    expect(bandFor(45)).toBe("medium");
    expect(bandFor(10)).toBe("low");
  });

  it("uses custom thresholds when passed, e.g. from an owner's RuntimeConfig", () => {
    // A score that's "high" under the default thresholds (60/30) but only "medium" once an
    // owner raises highFitThreshold to 70 — this is the exact case the Projects UI and API
    // must agree on: FitBadge and the API's fit=high|medium|low filter both need to call
    // bandFor with the same thresholds or a row can be listed under one band and badged another.
    expect(bandFor(65, { highFitThreshold: 70, mediumFitThreshold: 30 })).toBe("medium");
    expect(bandFor(70, { highFitThreshold: 70, mediumFitThreshold: 30 })).toBe("high");
    expect(bandFor(29, { highFitThreshold: 70, mediumFitThreshold: 30 })).toBe("low");
  });
});

describe("scoreSmbFit", () => {
  it("scores a tenant-funded adult day care renovation as high", () => {
    const r = scoreSmbFit({
      name: "La Dulce Vida Adult Day Care",
      facilityName: "La Dulce Vida Adult Day Car",
      estimatedCost: 60_000,
      squareFootage: 3_175,
      tenantFunded: true,
      workType: "renovation",
    });
    expect(r.excluded).toBe(false);
    expect(r.band).toBe("high");
    expect(r.score).toBe(95);
    expect(r.reasons.map((x) => x.code)).toEqual([
      "positive_keyword",
      "tenant_funded",
      "sqft_under_5k",
      "cost_under_250k",
      "work_type",
    ]);
  });

  it("hard-excludes a health system by chain name", () => {
    const r = scoreSmbFit({ name: "TIRR MH Dialysis EVS", facilityName: "TIRR Memorial Hermann", estimatedCost: 1_705_000 });
    expect(r.excluded).toBe(true);
    expect(r.exclusionReasons[0]).toMatch(/^chain:memorial hermann/);
    expect(r.score).toBe(0);
  });

  it("hard-excludes by cost over the limit", () => {
    const r = scoreSmbFit({ name: "Hightower Business Park - Building 05", estimatedCost: 28_800_000, workType: "new_construction" });
    expect(r.excluded).toBe(true);
    expect(r.exclusionReasons).toContain("cost_over_2000000");
  });

  it("hard-excludes government and right-of-way work", () => {
    expect(scoreSmbFit({ name: "City of Houston Fire Station 12" }).excluded).toBe(true);
    expect(scoreSmbFit({ name: "Taylor Lester Park Entry Sidewalk", workType: "row" }).excluded).toBe(true);
  });

  it("hard-excludes same-name counts over the limit", () => {
    expect(scoreSmbFit({ name: "Quick Cuts", sameNameCount: 6 }).excluded).toBe(true);
    expect(scoreSmbFit({ name: "Quick Cuts", sameNameCount: 5 }).excluded).toBe(false);
  });

  it("applies soft negatives with a floor of zero", () => {
    const r = scoreSmbFit({ name: "Riverside Apartments Clubhouse", estimatedCost: 100_000 });
    expect(r.excluded).toBe(false);
    expect(r.score).toBe(0);
    expect(r.band).toBe("low");
  });

  it("scores keyword alone as low and keyword plus small cost as medium", () => {
    const r = scoreSmbFit({ name: "Bella Nails & Spa" });
    expect(r.score).toBe(25);
    expect(r.band).toBe("low");
    const r2 = scoreSmbFit({ name: "Bella Nails & Spa", estimatedCost: 100_000 });
    expect(r2.band).toBe("medium");
  });

  it("does not exclude on partial chain match", () => {
    const r = scoreSmbFit({ name: "Chasewood Family Dental" });
    expect(r.excluded).toBe(false);
    expect(r.score).toBe(25);
  });

  it("does not apply soft negative on partial keyword match", () => {
    const r = scoreSmbFit({ name: "Parkway Dental", estimatedCost: 100_000 });
    expect(r.excluded).toBe(false);
    expect(r.score).toBe(45);
    expect(r.band).toBe("medium");
    expect(r.reasons.map((x) => x.code)).toEqual(["positive_keyword", "cost_under_250k"]);
  });

  it("hard-excludes by exact chain name", () => {
    const r = scoreSmbFit({ name: "HEB Grocery" });
    expect(r.excluded).toBe(true);
    expect(r.exclusionReasons[0]).toMatch(/^chain:/);
  });

  it("hard-excludes McDonald's", () => {
    const r = scoreSmbFit({ name: "McDonald's" });
    expect(r.excluded).toBe(true);
  });

  it("floors soft negatives even when cost is positive", () => {
    const r = scoreSmbFit({ name: "Hightower Business Park - Building 05", estimatedCost: 100_000 });
    expect(r.excluded).toBe(false);
    expect(r.score).toBe(0);
    expect(r.band).toBe("low");
    expect(r.reasons.map((x) => x.code)).toEqual(["cost_under_250k", "soft_negative", "soft_negative"]);
  });

  // Plan 9 Task 3: Zumiez, Pet Paradise and H&R Block escaped chain exclusion under the original
  // name-list (they were never on it at all) — the headcount signal in runEnrich/chain-sweep
  // catches them independently of this list, but the seed list itself should also know about
  // these well-known national chains so they're excluded up front, at zip-search time.
  it.each([
    ["Zumiez"],
    ["Pet Paradise Pearland"],
    ["H&R Block"],
    ["Jiffy Lube"],
    ["GEICO Insurance Agent"],
  ])("hard-excludes the seeded chain %s", (name) => {
    const r = scoreSmbFit({ name });
    expect(r.excluded).toBe(true);
    expect(r.exclusionReasons[0]).toMatch(/^chain:/);
  });

  // Franchise/agent-owned storefronts are real SMB prospects, not head-office-run chains, and are
  // deliberately kept off the seed list even though they share a brand name with a franchisor.
  it.each([["Snap Fitness Pearland"], ["State Farm - Jane Smith"]])(
    "does not exclude the franchise/agent-owned business %s",
    (name) => {
      expect(scoreSmbFit({ name }).excluded).toBe(false);
    },
  );
});
