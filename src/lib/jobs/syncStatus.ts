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
  finishedAt?: string;
  error?: string | null;
  counts?: Record<string, number>;
};

export async function readSync(key: SyncKey): Promise<{ lastSuccessfulAt: Date | null; cursor: SyncCursor }> {
  const row = await prisma.syncState.findUnique({ where: { key } });
  return { lastSuccessfulAt: row?.lastSuccessfulAt ?? null, cursor: ((row?.cursor as SyncCursor | null) ?? { status: "idle" }) };
}

export async function writeSync(key: SyncKey, cursor: SyncCursor, lastSuccessfulAt?: Date): Promise<void> {
  await prisma.syncState.upsert({
    where: { key },
    update: { cursor: cursor as Prisma.InputJsonValue, ...(lastSuccessfulAt && { lastSuccessfulAt }) },
    create: { key, cursor: cursor as Prisma.InputJsonValue, lastSuccessfulAt: lastSuccessfulAt ?? null },
  });
}
