import { prisma } from "@/lib/db";
import { getActor } from "@/lib/actor";
import { ApiError, handle, json } from "@/lib/api";
import { enqueueEnrich } from "@/lib/jobs/enqueue";
import { isProviderConfigured } from "@/lib/providers/keys";

export const POST = handle(async (_req, ctx) => {
  const { id } = await ctx.params;
  const actor = await getActor();
  const b = await prisma.business.findFirst({ where: { id, ownerId: actor.id }, select: { id: true } });
  if (!b) throw new ApiError(404, "Business not found");
  if (!(await isProviderConfigured("apollo"))) {
    return json({ error: "Apollo API key is not configured", settingsHref: "/settings" }, 409);
  }
  const queued = await enqueueEnrich(b.id, actor.id);
  return json({ queued }, 202);
});
