import { z } from "zod";
import { prisma } from "@/lib/db";
import { getActor } from "@/lib/actor";
import { ApiError, handle, json, parseJson } from "@/lib/api";
import { ENRICH_CONFIG } from "@/lib/config/enrichment";
import { loadConfig } from "@/lib/config/runtime";
import { creditStatus, estimateCredits } from "@/lib/enrichment/credits";
import { enqueueEnrich } from "@/lib/jobs/enqueue";
import { isProviderConfigured, isProviderEnabled } from "@/lib/providers/keys";
import { apolloPlanBlocked } from "@/lib/providers/apollo";
import { APOLLO_PLAN_BLOCK_MESSAGE } from "@/lib/providers/errors";

/** Refuses at the monthly Apollo credit cap before any provider call is queued, shared by the
 * single-business and bulk enrich routes. Takes an already-loaded config so callers that also
 * need it (e.g. for the default `people` count) don't load it twice. Returns null when there is
 * remaining budget. */
async function assertCredits(ownerId: string, cfg: Awaited<ReturnType<typeof loadConfig>>) {
  const s = await creditStatus(ownerId, cfg);
  if (s.remaining <= 0) {
    const error = s.apollo
      ? `Apollo credits exhausted (${s.used}/${s.cap} this cycle; Apollo reports ${s.apollo.leftOver} left)`
      : `Apollo monthly credit cap reached (${s.used}/${s.cap})`;
    return json({ error, settingsHref: "/settings" }, 409);
  }
  return null;
}

const schema = z.object({
  ids: z.array(z.string()).min(1).max(500),
  outreachStatus: z.enum(["not_contacted", "contacted", "interested", "not_a_fit", "customer"]).optional(),
  addTagId: z.string().optional(),
  enrich: z.boolean().optional(),
  enrichForce: z.boolean().optional(),
  people: z.number().int().min(1).max(ENRICH_CONFIG.maxPeopleLimit).optional(),
});

export const POST = handle(async (req) => {
  const actor = await getActor();
  const body = await parseJson(req, schema);
  const owned = await prisma.business.findMany({ where: { id: { in: body.ids }, ownerId: actor.id }, select: { id: true, exclusion: true } });
  const ids = owned.map((b) => b.id);

  if (body.addTagId) {
    const tag = await prisma.tag.findFirst({ where: { id: body.addTagId, ownerId: actor.id } });
    if (!tag) throw new ApiError(404, "Tag not found");
  }

  let estimatedCredits = 0;
  if (body.enrich) {
    if (body.ids.length > 10) throw new ApiError(400, "Enrich at most 10 leads per action");
    if (!(await isProviderConfigured("apollo"))) {
      return json({ error: "Apollo API key is not configured", settingsHref: "/settings" }, 409);
    }
    if (!(await isProviderEnabled("apollo"))) {
      return json({ error: "Apollo is disabled in Settings", settingsHref: "/settings" }, 409);
    }
    if ((await apolloPlanBlocked()).blocked) {
      return json({ error: APOLLO_PLAN_BLOCK_MESSAGE, settingsHref: "/settings" }, 409);
    }
    const cfg = await loadConfig(actor.id);
    const capError = await assertCredits(actor.id, cfg);
    if (capError) return capError;
    const people = body.people ?? cfg.enrichment.maxPeople;
    estimatedCredits = estimateCredits(ids.length, people);
  }

  if (body.outreachStatus) {
    await prisma.business.updateMany({ where: { id: { in: ids } }, data: { outreachStatus: body.outreachStatus } });
    await prisma.activityLog.createMany({
      data: ids.map((businessId) => ({ ownerId: actor.id, businessId, kind: "status_changed", message: `Status set to ${body.outreachStatus} (bulk)` })),
    });
  }
  if (body.addTagId) {
    await prisma.businessTag.createMany({ data: ids.map((businessId) => ({ businessId, tagId: body.addTagId! })), skipDuplicates: true });
  }
  let enrichQueued = 0;
  let enrichFailed = 0;
  let enrichSkipped = 0;
  if (body.enrich) {
    // Excluded businesses are never queued for enrichment (mirrors the single-business route's
    // 409): skip them silently here (a bulk action shouldn't fail for a mixed selection) but
    // report the count so the UI can say what happened instead of implying they were queued.
    for (const b of owned) {
      if (b.exclusion !== "none") {
        enrichSkipped++;
        continue;
      }
      try {
        if (await enqueueEnrich(b.id, actor.id, { force: body.enrichForce, people: body.people })) enrichQueued++;
      } catch (e) {
        enrichFailed++;
        console.error(`[bulk enrich] ${b.id}`, e);
      }
    }
  }
  return json({ updated: ids.length, enrichQueued, enrichFailed, enrichSkipped, estimatedCredits });
});
