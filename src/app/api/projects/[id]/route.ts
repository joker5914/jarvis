import { getActor } from "@/lib/actor";
import { ApiError, handle, json } from "@/lib/api";
import { getProjectDetail } from "@/lib/projects/queries";

export const GET = handle(async (_req, ctx) => {
  const { id } = await ctx.params;
  const actor = await getActor();
  const project = await getProjectDetail(id, actor.id);
  if (!project) throw new ApiError(404, "Project not found");
  return json({ project });
});
