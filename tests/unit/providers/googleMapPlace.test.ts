import { describe, it, expect } from "vitest";
import { mapPlace, cityAndState } from "@/lib/providers/google";

describe("mapPlace", () => {
  it("tolerates address components without a types array (seen in real Place Details responses)", () => {
    const biz = mapPlace({
      id: "ChIJreal",
      displayName: { text: "Pearland Nails" },
      formattedAddress: "123 Broadway St, Pearland, TX 77581, USA",
      addressComponents: [
        { longText: "Suite 4", shortText: "Suite 4" } as never,
        { longText: "77581", shortText: "77581", types: ["postal_code"] },
      ],
    } as never);
    expect(biz.zip).toBe("77581");
    expect(biz.name).toBe("Pearland Nails");
  });
  it("returns a null zip when no component carries postal_code", () => {
    const biz = mapPlace({ id: "x", displayName: { text: "X" }, addressComponents: [{ longText: "TX" } as never] } as never);
    expect(biz.zip).toBeNull();
  });
});

describe("cityAndState", () => {
  it("tolerates geocoding components without types", () => {
    const r = cityAndState([
      { long_name: "odd", short_name: "odd" } as never,
      { long_name: "Pearland", short_name: "Pearland", types: ["locality"] },
      { long_name: "Texas", short_name: "TX", types: ["administrative_area_level_1"] },
    ]);
    expect(r).toEqual({ city: "Pearland", state: "TX" });
  });
});
