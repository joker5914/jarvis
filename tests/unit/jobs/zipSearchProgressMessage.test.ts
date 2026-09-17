import { describe, it, expect } from "vitest";
import { pendingDiscoveryMessage } from "@/lib/jobs/zipSearch";

describe("pendingDiscoveryMessage", () => {
  it("names the pending count and explains the nightly auto-continue", () => {
    expect(pendingDiscoveryMessage(312)).toBe(
      "312 more places found but not yet fetched (Google daily budget) — continues automatically after midnight",
    );
  });

  it("still renders a sensible sentence at zero (callers only use this when pending > 0)", () => {
    expect(pendingDiscoveryMessage(0)).toBe(
      "0 more places found but not yet fetched (Google daily budget) — continues automatically after midnight",
    );
  });

  it("uses the raw count with no rounding or formatting", () => {
    expect(pendingDiscoveryMessage(1)).toBe(
      "1 more places found but not yet fetched (Google daily budget) — continues automatically after midnight",
    );
  });
});
