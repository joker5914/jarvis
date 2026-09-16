import { prisma } from "@/lib/db";
import { getActor } from "@/lib/actor";
import { handle, json } from "@/lib/api";
import { readScanner } from "@/lib/scanner/state";
import { isWithinWindow } from "@/lib/scanner/window";
import { budgetStatus } from "@/lib/providers/budget";

export const GET = handle(async () => {
  const actor = await getActor();
  const [{ schedule, state, targets }, budget, activity] = await Promise.all([
    readScanner(actor.id),
    budgetStatus("google"),
    prisma.activityLog.findMany({ where: { ownerId: actor.id, kind: "scanner" }, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);
  return json({ state, schedule, targets, budget, window: isWithinWindow(schedule), activity });
});
