import { describe, it, expect } from "vitest";
import { mapPlace, radiusFromViewport, cityAndState } from "@/lib/providers/google";

describe("google mappers", () => {
  it("maps a Places (New) result", () => {
    const b = mapPlace({
      id: "ChIJabc",
      displayName: { text: "Bella Nails & Spa" },
      formattedAddress: "123 Main St, Houston, TX 77084, USA",
      location: { latitude: 29.84, longitude: -95.66 },
      nationalPhoneNumber: "(713) 555-0100",
      websiteUri: "http://bellanails.com/",
      rating: 4.6,
      userRatingCount: 88,
      types: ["nail_salon", "point_of_interest"],
      addressComponents: [{ longText: "77084", types: ["postal_code"] }],
    });
    expect(b).toEqual({
      placeId: "ChIJabc",
      name: "Bella Nails & Spa",
      formattedAddress: "123 Main St, Houston, TX 77084, USA",
      zip: "77084",
      lat: 29.84,
      lng: -95.66,
      phone: "(713) 555-0100",
      websiteUrl: "http://bellanails.com/",
      rating: 4.6,
      reviewCount: 88,
      types: ["nail_salon", "point_of_interest"],
    });
  });

  it("derives a clamped radius from a viewport", () => {
    const r = radiusFromViewport({
      northeast: { lat: 29.9, lng: -95.6 },
      southwest: { lat: 29.8, lng: -95.7 },
    });
    expect(r).toBeGreaterThan(5000);
    expect(r).toBeLessThanOrEqual(8000);
    expect(radiusFromViewport(undefined)).toBe(3000);
  });

  it("extracts city and state from geocode components", () => {
    expect(
      cityAndState([
        { long_name: "Houston", short_name: "Houston", types: ["locality", "political"] },
        { long_name: "Texas", short_name: "TX", types: ["administrative_area_level_1", "political"] },
      ]),
    ).toEqual({ city: "Houston", state: "TX" });
  });
});
