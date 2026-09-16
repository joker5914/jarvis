import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";

export const SYNC_KEYS = { tdlr: "tdlr", promoteBatch: "promote-batch" } as const;
export type SyncKey = (typeof SYNC_KEYS)[keyof typeof SYNC_KEYS];

export type SyncCursor = {
  status: "idle" | "running" | "paused" | "failed";
  message?: string;
  current?: number;
  total?: number;
  startedAt?: string;
  /** Stamped by every writeSync call; reflects the last time this job actually made progress. */
  updatedAt?: string;
  finishedAt?: string;
  error?: string | null;
  counts?: Record<string, number>;
};

export const RUNNING_STALE_MS = 2 * 60 * 60 * 1000;

/**
 * A cursor stuck at "running" older than RUNNING_STALE_MS is treated as abandoned (e.g. a
 * hard worker crash never wrote a terminal status), so callers don't block on it forever.
 * Staleness keys off `updatedAt` (the last time any writeSync touched this job) rather than
 * `startedAt`, so a long-but-progressing run (e.g. a multi-hour backfill) isn't flagged
 * abandoned just because it started more than RUNNING_STALE_MS ago.
 */
export function isSyncRunning(cursor: SyncCursor, now: Date = new Date()): boolean {
  if (cursor.status !== "running") return false;
  const ref = cursor.updatedAt ?? cursor.startedAt;
  if (!ref) return true;
  return now.getTime() - Date.parse(ref) < RUNNING_STALE_MS;
}

export async function readSync(key: SyncKey): Promise<{ lastSuccessfulAt: Date | null; cursor: SyncCursor }> {
  const row = await prisma.syncState.findUnique({ where: { key } });
  return { lastSuccessfulAt: row?.lastSuccessfulAt ?? null, cursor: ((row?.cursor as SyncCursor | null) ?? { status: "idle" }) };
}

export async function writeSync(key: SyncKey, cursor: SyncCursor, lastSuccessfulAt?: Date): Promise<void> {
  const stamped: SyncCursor = { ...cursor, updatedAt: new Date().toISOString() };
  await prisma.syncState.upsert({
    where: { key },
    update: { cursor: stamped as Prisma.InputJsonValue, ...(lastSuccessfulAt && { lastSuccessfulAt }) },
    create: { key, cursor: stamped as Prisma.InputJsonValue, lastSuccessfulAt: lastSuccessfulAt ?? null },
  });
}
