import { z } from "zod";
import { prisma } from "@/lib/db";
import { getActor } from "@/lib/actor";
import { ApiError, handle, json, parseJson } from "@/lib/api";
import { getBusinessDetail } from "@/lib/leads/queries";
import { PRODUCT_SLUGS } from "@/lib/config/packages";

export const GET = handle(async (_req, ctx) => {
  const { id } = await ctx.params;
  const actor = await getActor();
  const business = await getBusinessDetail(id, actor.id);
  if (!business) throw new ApiError(404, "Business not found");
  return json({ business });
});

const patchSchema = z.object({
  outreachStatus: z.enum(["not_contacted", "contacted", "interested", "not_a_fit", "customer"]).optional(),
  productsPitched: z.array(z.enum(PRODUCT_SLUGS as [string, ...string[]])).optional(),
  notes: z.string().max(20_000).optional(),
  tagIds: z.array(z.string()).optional(),
});

export const PATCH = handle(async (req, ctx) => {
  const { id } = await ctx.params;
  const actor = await getActor();
  const existing = await prisma.business.findFirst({ where: { id, ownerId: actor.id } });
  if (!existing) throw new ApiError(404, "Business not found");
  const body = await parseJson(req, patchSchema);

  // Verify tag ownership before transaction
  let ownedTagIds: string[] = [];
  if (body.tagIds) {
    const ownedTags = await prisma.tag.findMany({ where: { id: { in: body.tagIds }, ownerId: actor.id }, select: { id: true } });
    ownedTagIds = ownedTags.map((t) => t.id);
  }

  await prisma.$transaction(async (tx) => {
    await tx.business.update({
      where: { id },
      data: {
        ...(body.outreachStatus !== undefined && { outreachStatus: body.outreachStatus }),
        ...(body.productsPitched !== undefined && { productsPitched: body.productsPitched }),
        ...(body.notes !== undefined && { notes: body.notes }),
      },
    });
    if (body.tagIds) {
      await tx.businessTag.deleteMany({ where: { businessId: id } });
      await tx.businessTag.createMany({ data: ownedTagIds.map((tagId) => ({ businessId: id, tagId })), skipDuplicates: true });
    }
    if (body.outreachStatus && body.outreachStatus !== existing.outreachStatus) {
      await tx.activityLog.create({
        data: { ownerId: actor.id, businessId: id, kind: "status_changed", message: `Status set to ${body.outreachStatus}` },
      });
    }
  });

  const business = await getBusinessDetail(id, actor.id);
  return json({ business });
});
