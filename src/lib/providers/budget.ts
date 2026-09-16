import { prisma } from "@/lib/db";

export class BudgetExhaustedError extends Error {
  constructor(public provider: string) {
    super(`Daily budget exhausted for ${provider}`);
    this.name = "BudgetExhaustedError";
  }
}

export function todayKey(tz = "America/Chicago"): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function defaultBudgetFor(provider: string): number {
  const raw = process.env[`${provider.toUpperCase()}_DAILY_BUDGET`];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 1000;
}

/** Counts one call against the provider's daily budget, then runs fn. */
export async function withBudget<T>(provider: string, fn: () => Promise<T>): Promise<T> {
  const today = todayKey();
  const cfg = await prisma.providerConfig.upsert({
    where: { provider },
    update: {},
    create: { provider, dailyBudget: defaultBudgetFor(provider) },
  });
  if (!cfg.enabled) throw new Error(`Provider ${provider} is disabled`);
  const used = cfg.usageDate === today ? cfg.usedToday : 0;
  if (used >= cfg.dailyBudget) throw new BudgetExhaustedError(provider);
  await prisma.providerConfig.update({
    where: { provider },
    data: { usageDate: today, usedToday: used + 1 },
  });
  return fn();
}

export async function budgetStatus(provider: string) {
  const cfg = await prisma.providerConfig.findUnique({ where: { provider } });
  if (!cfg) return { used: 0, limit: defaultBudgetFor(provider), exhausted: false };
  const used = cfg.usageDate === todayKey() ? cfg.usedToday : 0;
  return { used, limit: cfg.dailyBudget, exhausted: used >= cfg.dailyBudget };
}
