import { describe, it, expect } from "vitest";
import { creditCycleStart, creditStatus, estimateCredits } from "@/lib/enrichment/credits";
import { REGION } from "@/lib/config/region";
import type { RuntimeConfig } from "@/lib/config/runtime";
import type { ApolloCreditUsage, EnrichmentProvider } from "@/lib/providers/types";

const TZ = "America/Chicago";
describe("creditCycleStart", () => {
  it("defaults to the first of the current month in the schedule timezone", () => {
    expect(creditCycleStart(new Date("2026-09-17T05:00:00Z"), null, TZ).toISOString()).toBe("2026-09-01T05:00:00.000Z"); // 00:00 CDT
  });
  it("uses the renewal day-of-month: before the day → last month's occurrence", () => {
    expect(creditCycleStart(new Date("2026-10-10T12:00:00Z"), "2026-10-15", TZ).toISOString()).toBe("2026-09-15T05:00:00.000Z");
  });
  it("on/after the renewal day → this month's occurrence", () => {
    expect(creditCycleStart(new Date("2026-10-20T12:00:00Z"), "2026-10-15", TZ).toISOString()).toBe("2026-10-15T05:00:00.000Z");
  });
  it("clamps day 31 to shorter months", () => {
    expect(creditCycleStart(new Date("2026-04-30T12:00:00Z"), "2026-01-31", TZ).toISOString()).toBe("2026-04-30T05:00:00.000Z");
  });
});
describe("estimateCredits", () => {
  it("is businesses × people", () => expect(estimateCredits(10, 1)).toBe(10));
});

describe("creditStatus with a live Apollo balance", () => {
  const cfg = (cap: number, cycleRenewsOn: string | null) => ({ enrichment: { maxPeople: 1, monthlyCreditCap: cap, cycleRenewsOn } }) as unknown as RuntimeConfig;
  const provider = (usage: ApolloCreditUsage | null) => ({ creditUsage: async () => usage }) as unknown as EnrichmentProvider;
  const live: ApolloCreditUsage = { limit: 2510, consumed: 2, leftOver: 5, cycleStart: new Date("2026-09-17T04:58:17Z"), cycleEnd: new Date("2026-10-17T04:58:17Z"), fetchedAt: new Date() };
  const at = new Date("2026-09-20T12:00:00Z");
  // creditsUsed hits Prisma; creditStatus takes a 5th `deps` param `{ creditsUsed }` defaulting to the real one.
  const deps = { creditsUsed: async () => 2 };

  it("remaining is the smaller of the app cap and Apollo's balance", async () => {
    const s = await creditStatus("o", cfg(500, "2026-10-16"), at, provider(live), deps);
    expect(s).toMatchObject({ used: 2, cap: 500, remaining: 5, apollo: { limit: 2510, consumed: 2, leftOver: 5, cycleEnd: "2026-10-16" } });
  });
  it("falls back to the app cap alone when Apollo is unavailable", async () => {
    const s = await creditStatus("o", cfg(500, "2026-10-16"), at, provider(null), deps);
    expect(s).toMatchObject({ remaining: 498, apollo: null });
  });
  it("derives the renewal day from Apollo's cycle end (local date) when Settings leaves it blank", async () => {
    const s = await creditStatus("o", cfg(500, null), at, provider(live), deps);
    expect(s.cycleRenewsOn).toBe("2026-10-16"); // 04:58Z on the 17th is 11:58 PM on the 16th in REGION.timezone
    expect(s.cycleStart.toISOString()).toBe(creditCycleStart(at, "2026-10-16", REGION.timezone).toISOString());
  });
});
