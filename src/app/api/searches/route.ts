import { z } from "zod";
import { prisma } from "@/lib/db";
import { getActor } from "@/lib/actor";
import { handle, json, parseJson } from "@/lib/api";
import { enqueueZipSearch } from "@/lib/jobs/enqueue";

export const GET = handle(async () => {
  const actor = await getActor();
  const items = await prisma.search.findMany({ where: { ownerId: actor.id }, orderBy: { createdAt: "desc" }, take: 100 });
  return json({ items });
});

const createSchema = z.object({ zip: z.string().regex(/^\d{5}$/, "Enter a 5-digit zip code") });

export const POST = handle(async (req) => {
  const actor = await getActor();
  const { zip } = await parseJson(req, createSchema);
  const search = await prisma.search.create({ data: { ownerId: actor.id, zip } });
  await enqueueZipSearch(search.id);
  return json({ search }, 201);
});
