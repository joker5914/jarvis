import { describe, it, expect } from "vitest";
import { suggestPackage } from "@/lib/scoring/packageMap";

describe("suggestPackage", () => {
  it("maps categories", () => {
    expect(suggestPackage("restaurant")).toBe("internet_tv_voice");
    expect(suggestPackage("dentist")).toBe("internet_voice_multiline");
    expect(suggestPackage("nail_salon")).toBe("internet_mobile");
    expect(suggestPackage("daycare")).toBe("internet_voice");
  });
  it("prefers full_bundle for new construction", () => {
    expect(suggestPackage("restaurant", "new_construction")).toBe("full_bundle");
  });
  it("returns null for unknown", () => {
    expect(suggestPackage("nope")).toBeNull();
    expect(suggestPackage(null)).toBeNull();
  });
});
