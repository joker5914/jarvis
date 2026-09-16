import { describe, it, expect } from "vitest";
import { normalizeName } from "@/lib/jobs/zipSearch";

describe("normalizeName", () => {
  it("lowercases, strips punctuation and suffix noise", () => {
    expect(normalizeName("Bella Nails & Spa, LLC")).toBe("bella nails spa");
    expect(normalizeName("  Starbucks  ")).toBe("starbucks");
    expect(normalizeName("Joe's Auto-Repair Inc.")).toBe("joes auto repair");
  });
});
