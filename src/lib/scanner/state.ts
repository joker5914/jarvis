import { prisma } from "@/lib/db";
import { Prisma, type ScannerStatus } from "@prisma/client";

export async function readScanner(ownerId: string) {
  const [schedule, state, targets] = await Promise.all([
    prisma.scanSchedule.upsert({ where: { ownerId }, update: {}, create: { ownerId } }),
    prisma.scannerState.upsert({ where: { ownerId }, update: {}, create: { ownerId } }),
    prisma.scanTarget.findMany({ where: { ownerId }, orderBy: [{ priority: "desc" }, { zip: "asc" }] }),
  ]);
  return { schedule, state, targets };
}

export type NextPlanned = { kind: string; at: string | null; detail?: string };

export async function setScannerState(
  ownerId: string,
  data: {
    status?: ScannerStatus;
    currentJobId?: string | null;
    currentActivity?: string | null;
    nextPlanned?: NextPlanned | null;
    lastError?: string | null;
    lastTickAt?: Date;
    backoffUntil?: Date | null;
    consecutiveFailures?: number;
    skipUntil?: Record<string, string>;
  },
) {
  const { nextPlanned, skipUntil, ...rest } = data;
  await prisma.scannerState.update({
    where: { ownerId },
    data: {
      ...rest,
      ...(nextPlanned !== undefined && { nextPlanned: (nextPlanned ?? Prisma.JsonNull) as Prisma.InputJsonValue }),
      ...(skipUntil !== undefined && { skipUntil: skipUntil as Prisma.InputJsonValue }),
    },
  });
}

export async function logScanner(ownerId: string, message: string) {
  await prisma.activityLog.create({ data: { ownerId, kind: "scanner", message } });
}
