import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { withBudget, BudgetExhaustedError, budgetStatus } from "@/lib/providers/budget";
import { ProviderDisabledError } from "@/lib/providers/errors";

beforeEach(async () => {
  await prisma.providerConfig.deleteMany();
});

describe("withBudget", () => {
  it("counts calls and throws when the daily budget is hit", async () => {
    await prisma.providerConfig.create({ data: { provider: "google", dailyBudget: 2 } });
    expect(await withBudget("google", async () => "a")).toBe("a");
    expect(await withBudget("google", async () => "b")).toBe("b");
    await expect(withBudget("google", async () => "c")).rejects.toBeInstanceOf(BudgetExhaustedError);
    expect(await budgetStatus("google")).toEqual({ used: 2, limit: 2, exhausted: true });
  });

  it("creates the config row with the env default", async () => {
    process.env.GOOGLE_DAILY_BUDGET = "77";
    await withBudget("google", async () => 1);
    const cfg = await prisma.providerConfig.findUnique({ where: { provider: "google" } });
    expect(cfg?.dailyBudget).toBe(77);
    expect(cfg?.usedToday).toBe(1);
  });

  it("never overspends under concurrent calls", async () => {
    await prisma.providerConfig.create({ data: { provider: "google", dailyBudget: 3 } });
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => withBudget("google", async () => "ok")));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    expect(results.filter((r) => r.status === "rejected" && r.reason instanceof BudgetExhaustedError)).toHaveLength(5);
    expect((await budgetStatus("google")).used).toBe(3);
  });

  it("throws ProviderDisabledError when provider is disabled", async () => {
    await prisma.providerConfig.create({ data: { provider: "google", dailyBudget: 10, enabled: false } });
    await expect(withBudget("google", async () => "ok")).rejects.toBeInstanceOf(ProviderDisabledError);
    await expect(withBudget("google", async () => "ok")).rejects.toThrow(/disabled/);
  });
});
