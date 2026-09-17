import { prisma } from "@/lib/db";
import { getActor } from "@/lib/actor";
import { ApiError, handle, json } from "@/lib/api";
import { ENRICH_CONFIG } from "@/lib/config/enrichment";
import { loadConfig } from "@/lib/config/runtime";
import { creditStatus, estimateCredits } from "@/lib/enrichment/credits";
import { enqueueEnrich } from "@/lib/jobs/enqueue";
import { isProviderConfigured, isProviderEnabled } from "@/lib/providers/keys";

/** Refuses at the monthly Apollo credit cap before any provider call is queued, shared by the
 * single-business and bulk enrich routes. Returns null when there is remaining budget. */
async function assertCredits(ownerId: string) {
  const cfg = await loadConfig(ownerId);
  const s = await creditStatus(ownerId, cfg);
  if (s.remaining <= 0) {
    return json({ error: `Apollo monthly credit cap reached (${s.used}/${s.cap})`, settingsHref: "/settings" }, 409);
  }
  return null;
}

export const POST = handle(async (req, ctx) => {
  const { id } = await ctx.params;
  const actor = await getActor();
  const b = await prisma.business.findFirst({ where: { id, ownerId: actor.id }, select: { id: true, exclusion: true } });
  if (!b) throw new ApiError(404, "Business not found");
  if (b.exclusion !== "none") {
    return json({ error: "Excluded businesses are not enriched" }, 409);
  }
  if (!(await isProviderConfigured("apollo"))) {
    return json({ error: "Apollo API key is not configured", settingsHref: "/settings" }, 409);
  }
  if (!(await isProviderEnabled("apollo"))) {
    return json({ error: "Apollo is disabled in Settings", settingsHref: "/settings" }, 409);
  }
  // Body is optional (a plain "Enrich" click sends no body at all); force/people default accordingly.
  let force = false;
  let people: number | undefined;
  try {
    const body: unknown = await req.json();
    if (body && typeof body === "object") {
      if ("force" in body) force = Boolean((body as { force?: unknown }).force);
      if ("people" in body) {
        const p = Number((body as { people?: unknown }).people);
        if (Number.isInteger(p)) people = p;
      }
    }
  } catch {
    // no body, or not JSON — fine, force/people stay at their defaults
  }
  const capError = await assertCredits(actor.id);
  if (capError) return capError;
  const cfg = await loadConfig(actor.id);
  const resolvedPeople = Math.min(ENRICH_CONFIG.maxPeopleLimit, Math.max(1, people ?? cfg.enrichment.maxPeople));
  const queued = await enqueueEnrich(b.id, actor.id, { force, people });
  return json({ queued, estimatedCredits: estimateCredits(1, resolvedPeople) }, 202);
});
