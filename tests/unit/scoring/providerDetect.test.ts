import { describe, it, expect } from "vitest";
import { detectProvider } from "@/lib/scoring/providerDetect";

describe("detectProvider", () => {
  it("detects strong brands anywhere", () => {
    const r = detectProvider("Welcome! Free WiFi powered by AT&T Business. Open daily.");
    expect(r?.provider).toBe("att");
    expect(r?.evidence).toContain("powered by AT&T");
  });
  it("requires context for ambiguous brands", () => {
    expect(detectProvider("Spectrum Dental Care is accepting new patients")).toBeNull();
    expect(detectProvider("Our internet service is provided by Spectrum Business")?.provider).toBe("spectrum");
  });
  it("returns null when nothing matches", () => {
    expect(detectProvider("Best tacos in Houston")).toBeNull();
  });
  it("normalizes T-Mobile and Google Fiber", () => {
    expect(detectProvider("we use T Mobile home internet")?.provider).toBe("tmobile");
    expect(detectProvider("Google Fiber available here")?.provider).toBe("google_fiber");
  });
});
