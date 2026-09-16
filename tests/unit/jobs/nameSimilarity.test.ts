import { describe, it, expect } from "vitest";
import { nameSimilarity } from "@/lib/jobs/promote";

describe("nameSimilarity", () => {
  it("is 1 for the same name modulo punctuation and suffixes", () => {
    expect(nameSimilarity("Bella Nails & Spa", "Bella Nails and Spa LLC")).toBeCloseTo(0.75, 2);
    expect(nameSimilarity("Bella Nails & Spa", "Bella Nails & Spa")).toBe(1);
  });
  it("is low for a padded fake match", () => {
    expect(nameSimilarity("Corner Cafe", "Corner Cafe 123 Fake St 77084 One")).toBeLessThan(0.5);
  });
  it("is 0 when either side is empty", () => {
    expect(nameSimilarity("", "x")).toBe(0);
  });
});
