import { describe, it, expect } from "vitest";
import { scoreProjectFields } from "@/lib/scoring/projectScoring";

const now = new Date("2026-09-16T12:00:00Z");
const d = (days: number) => new Date(now.getTime() + days * 86_400_000);

describe("scoreProjectFields", () => {
  it("bundles fit, exclusion, and timing for a tenant-funded salon build-out", () => {
    const s = scoreProjectFields({
      projectName: "Bella Nails Buildout", facilityName: "Bella Nails & Spa", estimatedCost: 120_000, squareFootage: 1_800,
      tenantFunded: true, workType: "renovation", startDate: d(-30), completionDate: d(30), statusCode: 3008,
    }, now);
    expect(s.exclusion).toBe("none");
    expect(s.smbFitScore).toBe(95);
    expect(s.smbFitBand).toBe("high");
    expect(s.timingWindow).toBe("opening_soon");
  });
  it("hard-excludes a health system and still computes timing", () => {
    const s = scoreProjectFields({
      projectName: "Memorial Hermann Tower Dialysis", facilityName: "Memorial Hermann", estimatedCost: 5_000_000, squareFootage: null,
      tenantFunded: null, workType: "new_construction", startDate: d(-10), completionDate: d(200), statusCode: 3008,
    }, now);
    expect(s.exclusion).toBe("enterprise");
    expect(s.exclusionReasons[0]).toMatch(/^chain:memorial hermann/);
    expect(s.smbFitScore).toBe(0);
    expect(s.timingWindow).toBe("under_construction");
  });
});
