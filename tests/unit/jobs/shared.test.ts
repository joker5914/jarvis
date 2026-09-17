import { describe, it, expect } from "vitest";
import { checkPause, JobPausedError, normalizeName, discoveredToBusinessFields, recheckPauseCheck } from "@/lib/jobs/shared";
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

// Defect fix: the website-recheck worker handler always passed scannerPauseCheck regardless of
// origin, so the cleanup script's manual re-checks paused on a disabled Scanner within
// milliseconds. recheckPauseCheck is the pure decision the handler now uses instead — it's
// never invoked here (that would need a DB-backed ScannerState), just checked for shape, which
// is enough to prove "manual" is the only origin that opts out.
describe("recheckPauseCheck", () => {
  it("returns undefined for a manual-origin job (never pauses on the Scanner)", () => {
    expect(recheckPauseCheck("manual", "owner-1")).toBeUndefined();
  });
  it("returns a shouldPause function for scanner-origin", () => {
    expect(typeof recheckPauseCheck("scanner", "owner-1")).toBe("function");
  });
  it("treats a missing origin (legacy job queued before this field existed) as scanner-origin", () => {
    expect(typeof recheckPauseCheck(undefined, "owner-1")).toBe("function");
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
