import { describe, it, expect } from "vitest";
import { checkPause, JobPausedError, normalizeName, discoveredToBusinessFields } from "@/lib/jobs/shared";
import { FakeDiscoveryProvider, FakeEnrichmentProvider, FakeGeocodeProvider, FakeRegistryProvider, FakeValidationProvider, fakeFetcher } from "@/lib/providers/fake";

const providers = {
  geocode: new FakeGeocodeProvider(),
  discovery: new FakeDiscoveryProvider(),
  validation: new FakeValidationProvider(),
  registry: new FakeRegistryProvider(),
  fetcher: fakeFetcher,
  enrichment: new FakeEnrichmentProvider(),
};

describe("checkPause", () => {
  it("throws JobPausedError when the signal is aborted", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(checkPause({ providers, signal: ctrl.signal })).rejects.toBeInstanceOf(JobPausedError);
  });
  it("throws when shouldPause resolves true and passes otherwise", async () => {
    await expect(checkPause({ providers, shouldPause: async () => true })).rejects.toBeInstanceOf(JobPausedError);
    await expect(checkPause({ providers, shouldPause: async () => false })).resolves.toBeUndefined();
    await expect(checkPause({ providers })).resolves.toBeUndefined();
  });
});

describe("normalizeName", () => {
  it("still normalizes suffixes and punctuation", () => {
    expect(normalizeName("Joe's Auto-Repair Inc.")).toBe("joes auto repair");
  });
});

describe("discoveredToBusinessFields", () => {
  it("maps the ten Google columns", () => {
    const f = discoveredToBusinessFields({
      placeId: "p1", name: "N", formattedAddress: "A", zip: "77084", lat: 1, lng: 2, phone: "p", websiteUrl: "w", rating: 4.5, reviewCount: 9, types: ["t"],
    });
    expect(f).toEqual({ name: "N", formattedAddress: "A", zip: "77084", lat: 1, lng: 2, phone: "p", websiteUrl: "w", googleRating: 4.5, googleReviewCount: 9, googleTypes: ["t"] });
  });
});
