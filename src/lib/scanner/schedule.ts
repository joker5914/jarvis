import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/api";

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:mm");
const isoDate = z.string().datetime({ offset: true }).transform((s) => new Date(s));
const timezone = z.string().refine((tz) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, "Unknown IANA timezone");

export const scheduleUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  windowStart: isoDate.nullable().optional(),
  windowEnd: isoDate.nullable().optional(),
  dailyStartTime: hhmm.nullable().optional(),
  dailyEndTime: hhmm.nullable().optional(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  timezone: timezone.optional(),
  zipRefreshDays: z.number().int().min(1).max(90).optional(),
  tdlrSyncHours: z.number().int().min(1).max(168).optional(),
  websiteRecheckDays: z.number().int().min(1).max(365).optional(),
  autoAddHotZips: z.boolean().optional(),
  maxConcurrentJobs: z.number().int().min(1).max(2).optional(),
});

export type ScheduleUpdate = z.infer<typeof scheduleUpdateSchema>;

async function runScheduleUpdate(ownerId: string, data: Record<string, unknown>) {
  return prisma.$transaction(
    async (tx) => {
      // windowStart/windowEnd can each arrive independently in a partial update, so the
      // ordering check needs the effective pair (new value if given, else whatever's already
      // persisted) — read inside the same serializable transaction as the write below so two
      // concurrent updates that each look valid against the *old* row (one moving windowStart
      // forward, the other moving windowEnd back) can't both commit and leave the row with
      // windowEnd < windowStart: Postgres aborts one with a serialization failure (P2034),
      // which the caller retries, and the retry re-reads the other's now-committed value.
      if ("windowStart" in data || "windowEnd" in data) {
        const current = await tx.scanSchedule.findUnique({ where: { ownerId } });
        const windowStart = "windowStart" in data ? (data.windowStart as Date | null) : (current?.windowStart ?? null);
        const windowEnd = "windowEnd" in data ? (data.windowEnd as Date | null) : (current?.windowEnd ?? null);
        if (windowStart && windowEnd && windowEnd < windowStart) {
          throw new ApiError(400, "windowEnd must not be before windowStart");
        }
      }
      return tx.scanSchedule.upsert({ where: { ownerId }, update: data, create: { ownerId, ...data } });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function applyScheduleUpdate(ownerId: string, update: ScheduleUpdate) {
  const data = Object.fromEntries(Object.entries(update).filter(([, v]) => v !== undefined));
  try {
    return await runScheduleUpdate(ownerId, data);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034") {
      return await runScheduleUpdate(ownerId, data);
    }
    throw e;
  }
}
