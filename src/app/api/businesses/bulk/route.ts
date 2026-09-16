import { z } from "zod";
import { prisma } from "@/lib/db";
import { getActor } from "@/lib/actor";
import { ApiError, handle, json, parseJson } from "@/lib/api";
import { enqueueEnrich } from "@/lib/jobs/enqueue";
import { isProviderConfigured } from "@/lib/providers/keys";

const schema = z.object({
  ids: z.array(z.string()).min(1).max(500),
  outreachStatus: z.enum(["not_contacted", "contacted", "interested", "not_a_fit", "customer"]).optional(),
  addTagId: z.string().optional(),
  enrich: z.boolean().optional(),
  enrichForce: z.boolean().optional(),
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

  if (body.enrich) {
    if (ids.length > 200) throw new ApiError(400, "Enrich at most 200 leads per action");
    if (!(await isProviderConfigured("apollo"))) throw new ApiError(409, "Apollo API key is not configured");
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
        if (await enqueueEnrich(b.id, actor.id, { force: body.enrichForce })) enrichQueued++;
      } catch (e) {
        enrichFailed++;
        console.error(`[bulk enrich] ${b.id}`, e);
      }
    }
  }
  return json({ updated: ids.length, enrichQueued, enrichFailed, enrichSkipped });
});
