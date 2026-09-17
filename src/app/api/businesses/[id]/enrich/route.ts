import { z } from "zod";
import { prisma } from "@/lib/db";
import { getActor } from "@/lib/actor";
import { ApiError, handle, json } from "@/lib/api";
import { ENRICH_CONFIG } from "@/lib/config/enrichment";
import { loadConfig } from "@/lib/config/runtime";
import { creditStatus, estimateCredits } from "@/lib/enrichment/credits";
import { enqueueEnrich } from "@/lib/jobs/enqueue";
import { isProviderConfigured, isProviderEnabled } from "@/lib/providers/keys";
import { apolloPlanBlocked } from "@/lib/providers/apollo";
import { APOLLO_PLAN_BLOCK_MESSAGE } from "@/lib/providers/errors";

const bodySchema = z.object({
  force: z.boolean().optional(),
  people: z.number().int().min(1).max(ENRICH_CONFIG.maxPeopleLimit).optional(),
});

/** Refuses at the monthly Apollo credit cap before any provider call is queued, shared by the
 * single-business and bulk enrich routes. Takes an already-loaded config so callers that also
 * need it (e.g. for the default `people` count) don't load it twice. Returns null when there is
 * remaining budget. */
async function assertCredits(ownerId: string, cfg: Awaited<ReturnType<typeof loadConfig>>) {
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
  if ((await apolloPlanBlocked()).blocked) {
    return json({ error: APOLLO_PLAN_BLOCK_MESSAGE, settingsHref: "/settings" }, 409);
  }
  // Body is optional (a plain "Enrich" click sends no body at all); an absent/unparsable body is
  // treated as `{}` so force/people fall back to their defaults, but a present-and-invalid
  // `people` (e.g. 0 or 6) fails validation with a 400 via the schema below.
  let raw: unknown = {};
  try {
    raw = await req.json();
  } catch {
    raw = {};
  }
  const body = bodySchema.parse(raw ?? {});
  const cfg = await loadConfig(actor.id);
  const capError = await assertCredits(actor.id, cfg);
  if (capError) return capError;
  const resolvedPeople = body.people ?? cfg.enrichment.maxPeople;
  const queued = await enqueueEnrich(b.id, actor.id, { force: body.force, people: body.people });
  return json({ queued, estimatedCredits: estimateCredits(1, resolvedPeople) }, 202);
});
