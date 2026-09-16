import { prisma } from "@/lib/db";
import { getActor } from "@/lib/actor";
import { handle, json } from "@/lib/api";
import { enqueueScannerTick } from "@/lib/jobs/enqueue";
import { logScanner, readScanner } from "@/lib/scanner/state";

export const POST = handle(async () => {
  const actor = await getActor();
  await readScanner(actor.id);
  const state = await prisma.scannerState.update({
    where: { ownerId: actor.id },
    data: { pauseRequested: false, status: "idle", consecutiveFailures: 0, lastError: null, backoffUntil: null },
  });
  await logScanner(actor.id, "Resumed by user");
  const ticked = await enqueueScannerTick();
  return json({ state, ticked });
});
