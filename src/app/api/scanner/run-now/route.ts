import { getActor } from "@/lib/actor";
import { handle, json } from "@/lib/api";
import { enqueueScannerTick } from "@/lib/jobs/enqueue";
import { logScanner } from "@/lib/scanner/state";

export const POST = handle(async () => {
  const actor = await getActor();
  const ticked = await enqueueScannerTick();
  await logScanner(actor.id, ticked ? "Tick requested by user" : "Tick already queued");
  return json({ ticked }, 202);
});
