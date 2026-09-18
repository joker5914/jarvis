import { z } from "zod";
import { prisma } from "@/lib/db";
import { getActor } from "@/lib/actor";
import { ApiError, handle, json } from "@/lib/api";
import { ENRICH_CONFIG } from "@/lib/config/enrichment";
import { loadConfig } from "@/lib/config/runtime";
import { estimateCredits, assertCredits } from "@/lib/enrichment/credits";
import { enqueueEnrich } from "@/lib/jobs/enqueue";
import { isProviderConfigured, isProviderEnabled } from "@/lib/providers/keys";
import { apolloPlanBlocked } from "@/lib/providers/apollo";
import { APOLLO_PLAN_BLOCK_MESSAGE } from "@/lib/providers/errors";

const bodySchema = z.object({
  force: z.boolean().optional(),
  people: z.number().int().min(1).max(ENRICH_CONFIG.maxPeopleLimit).optional(),
  // Plan 10 Task 1: reveal exactly this candidate (chosen from the free "Find people" list)
  // instead of running the auto-search/reveal loop — see runEnrich's `opts.apolloId` branch.
  apolloId: z.string().min(1).optional(),
});

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
  // A candidate reveal (apolloId) is always exactly one person, regardless of the configured
  // maxPeople/people default — estimatedCredits must say 1, not whatever a multi-person auto-run
  // would have cost.
  const resolvedPeople = body.apolloId ? 1 : (body.people ?? cfg.enrichment.maxPeople);
  const queued = await enqueueEnrich(b.id, actor.id, { force: body.force, people: body.people, apolloId: body.apolloId });
  // Fix round (B1): enqueueEnrich's singletonKey is now per-person (see that function's doc
  // comment), so `queued === false` means a job for this exact target (the auto-enrich, or this
  // same candidate) is already queued or running — not that a *different* reveal got silently
  // dropped. Surface it as a 409 rather than a false-positive 202 (LeadDetail's toast already
  // reads `data.error`).
  if (!queued) {
    return json({ error: "An enrichment for this lead is already queued" }, 409);
  }
  return json({ queued, estimatedCredits: estimateCredits(1, resolvedPeople) }, 202);
});
