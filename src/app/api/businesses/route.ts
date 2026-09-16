import { prisma } from "@/lib/db";
import { getActor } from "@/lib/actor";
import { handle, json } from "@/lib/api";
import { parseLeadFilters } from "@/lib/leads/filters";
import { listBusinesses } from "@/lib/leads/queries";

export const GET = handle(async (req) => {
  const actor = await getActor();
  const f = parseLeadFilters(req.nextUrl.searchParams);
  const [{ items, total }, runningSearches] = await Promise.all([
    listBusinesses(f, actor.id),
    prisma.search.count({ where: { ownerId: actor.id, status: { in: ["queued", "running"] } } }),
  ]);
  return json({ items, total, page: f.page, pageSize: f.pageSize, runningSearches });
});
