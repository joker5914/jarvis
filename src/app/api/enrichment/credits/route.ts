import { getActor } from "@/lib/actor";
import { handle, json } from "@/lib/api";
import { loadConfig } from "@/lib/config/runtime";
import { creditStatus } from "@/lib/enrichment/credits";

export const GET = handle(async () => {
  const actor = await getActor();
  const cfg = await loadConfig(actor.id);
  const status = await creditStatus(actor.id, cfg);
  return json({ ...status, maxPeople: cfg.enrichment.maxPeople });
});
