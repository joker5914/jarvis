import { describe, it, expect } from "vitest";
import { scoreSmbFit } from "@/lib/scoring/smbFit";

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
});
