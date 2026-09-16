import { prisma } from "@/lib/db";
import { getActor } from "@/lib/actor";
import { ApiError, handle, json } from "@/lib/api";
import { findBusinessCandidates, linkProjectToPlace } from "@/lib/jobs/promote";
import { enqueuePromote } from "@/lib/jobs/enqueue";
import { getProviders } from "@/lib/providers";

export const POST = handle(async (_req, ctx) => {
  const { id } = await ctx.params;
  const actor = await getActor();
  const project = await prisma.project.findFirst({ where: { id, ownerId: actor.id } });
  if (!project) throw new ApiError(404, "Project not found");
  if (project.businessId) return json({ linked: true, businessId: project.businessId, business: null });

  const found = await findBusinessCandidates(id, actor.id, { providers: getProviders() });
  if (found.auto) {
    const businessId = await linkProjectToPlace(id, actor.id, found.auto);
    await enqueuePromote(businessId, actor.id);
    return json({ linked: true, businessId, business: found.auto });
  }
  return json({ linked: false, candidates: found.candidates });
});
