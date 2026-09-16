import { getActor } from "@/lib/actor";
import { handle, json, parseJson } from "@/lib/api";
import { applyScheduleUpdate, scheduleUpdateSchema } from "@/lib/scanner/schedule";
import { logScanner } from "@/lib/scanner/state";

export const PUT = handle(async (req) => {
  const actor = await getActor();
  const update = await parseJson(req, scheduleUpdateSchema);
  const schedule = await applyScheduleUpdate(actor.id, update);
  await logScanner(actor.id, `Schedule updated: ${Object.keys(update).join(", ")}`);
  return json({ schedule });
});
