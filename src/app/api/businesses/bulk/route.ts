import { z } from "zod";
import { prisma } from "@/lib/db";
import { getActor } from "@/lib/actor";
import { ApiError, handle, json, parseJson } from "@/lib/api";

const schema = z.object({
  ids: z.array(z.string()).min(1).max(500),
  outreachStatus: z.enum(["not_contacted", "contacted", "interested", "not_a_fit", "customer"]).optional(),
  addTagId: z.string().optional(),
});

export const POST = handle(async (req) => {
  const actor = await getActor();
  const body = await parseJson(req, schema);
  const owned = await prisma.business.findMany({ where: { id: { in: body.ids }, ownerId: actor.id }, select: { id: true } });
  const ids = owned.map((b) => b.id);

  if (body.addTagId) {
    const tag = await prisma.tag.findFirst({ where: { id: body.addTagId, ownerId: actor.id } });
    if (!tag) throw new ApiError(404, "Tag not found");
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
  return json({ updated: ids.length });
});
