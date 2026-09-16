import { z } from "zod";
import { getActor } from "@/lib/actor";
import { ApiError, handle, json, parseJson } from "@/lib/api";
import { createBusinessFromProject, findBusinessCandidates, linkProjectToPlace } from "@/lib/jobs/promote";
import { enqueuePromote } from "@/lib/jobs/enqueue";
import { getProviders } from "@/lib/providers";

const schema = z.object({ placeId: z.string().min(1).optional(), createFromProject: z.boolean().optional() })
  .refine((b) => !!b.placeId !== !!b.createFromProject, { message: "Provide exactly one of placeId or createFromProject" });

export const POST = handle(async (req, ctx) => {
  const { id } = await ctx.params;
  const actor = await getActor();
  const body = await parseJson(req, schema);

  let businessId: string;
  if (body.createFromProject) {
    businessId = await createBusinessFromProject(id, actor.id, { providers: getProviders() });
  } else {
    const found = await findBusinessCandidates(id, actor.id, { providers: getProviders() });
    const pick = [found.auto, ...found.candidates].find((c) => c?.placeId === body.placeId);
    if (!pick) throw new ApiError(404, "Candidate not found; run find again");
    businessId = await linkProjectToPlace(id, actor.id, pick);
  }
  await enqueuePromote(businessId, actor.id);
  return json({ businessId }, 201);
});
