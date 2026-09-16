import { prisma } from "@/lib/db";
import { getActor } from "@/lib/actor";
import { ApiError, handle, json } from "@/lib/api";
import { enqueueZipSearch } from "@/lib/jobs/enqueue";

export const POST = handle(async (_req, ctx) => {
  const { id } = await ctx.params;
  const actor = await getActor();
  const prior = await prisma.search.findFirst({ where: { id, ownerId: actor.id } });
  if (!prior) throw new ApiError(404, "Search not found");
  const search = await prisma.search.create({ data: { ownerId: actor.id, zip: prior.zip } });
  await enqueueZipSearch(search.id);
  return json({ search }, 201);
});
