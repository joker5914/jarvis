import { describe, it, expect } from "vitest";
import { isGluedLocalPart, isGluedEmail } from "@/lib/extract/junk";

// Fix round (item 3): extracted out of scripts/cleanup-invalid-emails.ts so the classifier used
// to flag stored junk-email rows is unit-testable on its own.
describe("isGluedLocalPart", () => {
  it("flags the original leading zip/phone-fragment shape", () => {
    expect(isGluedLocalPart("77581info")).toBe(true);
    expect(isGluedLocalPart("-229-4384chefstevehaug")).toBe(true);
  });

  it("flags a phone fragment glued anywhere in the local part, not just at the start", () => {
    // Real case from item 2: stripping the leading zip alone still leaves a phone number
    // embedded further in ("832-295-3350"), so a stored row of this exact shape must also be
    // caught by the cleanup script's classifier.
    expect(isGluedLocalPart("phone832-295-3350emailamericanailspearland")).toBe(true);
  });

  it("flags a zip-shaped run of exactly 5 digits immediately followed by a letter, anywhere in the local part", () => {
    expect(isGluedLocalPart("promo12345off")).toBe(true);
    expect(isGluedLocalPart("77584lafemmebeautyloungelcc")).toBe(true);
  });

  it("does not flag longer digit runs (order/ticket-style aliases) or digits not followed by a letter", () => {
    expect(isGluedLocalPart("ref000001a")).toBe(false);
    expect(isGluedLocalPart("dept543210sales")).toBe(false);
    expect(isGluedLocalPart("box12345")).toBe(false);
  });

  it("does not flag a legit local part with a short digit run", () => {
    expect(isGluedLocalPart("john2024")).toBe(false);
    expect(isGluedLocalPart("sales3")).toBe(false);
  });
});

describe("isGluedEmail", () => {
  it("applies isGluedLocalPart to the part before the @", () => {
    expect(isGluedEmail("77581info@eatportara.com")).toBe(true);
    expect(isGluedEmail("info@eatportara.com")).toBe(false);
  });
});
