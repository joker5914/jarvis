import { prisma } from "@/lib/db";
import { REGION } from "@/lib/config/region";
import { ProviderDisabledError } from "./errors";

export class BudgetExhaustedError extends Error {
  constructor(public provider: string) {
    super(`Daily budget exhausted for ${provider}`);
    this.name = "BudgetExhaustedError";
  }
}

export function todayKey(tz: string = REGION.timezone): string {
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
  // Ensure the row exists (idempotent).
  await prisma.providerConfig.upsert({
    where: { provider },
    update: {},
    create: { provider, dailyBudget: defaultBudgetFor(provider) },
  });
  // Roll the date forward when needed (no-op otherwise).
  // Match null or non-today dates to reset the counter.
  await prisma.providerConfig.updateMany({
    where: { provider, OR: [{ usageDate: null }, { usageDate: { not: today } }] },
    data: { usageDate: today, usedToday: 0 },
  });
  // Atomically reserve one unit with SQL condition (Prisma where cannot compare columns).
  const reserved = await prisma.$executeRaw`UPDATE "ProviderConfig" SET "usedToday" = "usedToday" + 1 WHERE "provider" = ${provider} AND "enabled" = true AND "usageDate" = ${today} AND "usedToday" < "dailyBudget"`;
  if (reserved === 0) {
    // Re-read to determine the error reason.
    const cfg = await prisma.providerConfig.findUnique({ where: { provider } });
    if (!cfg?.enabled) throw new ProviderDisabledError(provider);
    throw new BudgetExhaustedError(provider);
  }
  return fn();
}

export async function budgetStatus(provider: string) {
  const cfg = await prisma.providerConfig.findUnique({ where: { provider } });
  if (!cfg) return { used: 0, limit: defaultBudgetFor(provider), exhausted: false };
  const used = cfg.usageDate === todayKey() ? cfg.usedToday : 0;
  return { used, limit: cfg.dailyBudget, exhausted: used >= cfg.dailyBudget };
}
