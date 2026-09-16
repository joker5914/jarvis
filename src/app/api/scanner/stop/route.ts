import { prisma } from "@/lib/db";
import { getActor } from "@/lib/actor";
import { handle, json } from "@/lib/api";
import { logScanner, readScanner } from "@/lib/scanner/state";

export const POST = handle(async () => {
  const actor = await getActor();
  await readScanner(actor.id);
  const [state, schedule] = await Promise.all([
    prisma.scannerState.update({ where: { ownerId: actor.id }, data: { pauseRequested: true, status: "disabled", currentActivity: null } }),
    prisma.scanSchedule.update({ where: { ownerId: actor.id }, data: { enabled: false } }),
  ]);
  await logScanner(actor.id, "Stopped by user");
  return json({ state, schedule });
});
