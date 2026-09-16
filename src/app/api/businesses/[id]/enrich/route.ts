import { prisma } from "@/lib/db";
import { getActor } from "@/lib/actor";
import { ApiError, handle, json } from "@/lib/api";
import { enqueueEnrich } from "@/lib/jobs/enqueue";
import { isProviderConfigured } from "@/lib/providers/keys";

export const POST = handle(async (req, ctx) => {
  const { id } = await ctx.params;
  const actor = await getActor();
  const b = await prisma.business.findFirst({ where: { id, ownerId: actor.id }, select: { id: true } });
  if (!b) throw new ApiError(404, "Business not found");
  if (!(await isProviderConfigured("apollo"))) {
    return json({ error: "Apollo API key is not configured", settingsHref: "/settings" }, 409);
  }
  // Body is optional (a plain "Enrich" click sends no body at all); force defaults to false.
  let force = false;
  try {
    const body: unknown = await req.json();
    if (body && typeof body === "object" && "force" in body) force = Boolean((body as { force?: unknown }).force);
  } catch {
    // no body, or not JSON — fine, force stays false
  }
  const queued = await enqueueEnrich(b.id, actor.id, { force });
  return json({ queued }, 202);
});
