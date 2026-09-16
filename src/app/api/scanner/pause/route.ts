import { prisma } from "@/lib/db";
import { getActor } from "@/lib/actor";
import { handle, json } from "@/lib/api";
import { logScanner, readScanner } from "@/lib/scanner/state";

export const POST = handle(async () => {
  const actor = await getActor();
  await readScanner(actor.id);
  const state = await prisma.scannerState.update({ where: { ownerId: actor.id }, data: { pauseRequested: true, status: "paused", currentActivity: null } });
  await logScanner(actor.id, "Paused by user");
  return json({ state });
});
