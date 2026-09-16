import { getActor } from "@/lib/actor";
import { handle } from "@/lib/api";
import { parseLeadFilters } from "@/lib/leads/filters";
import { listBusinesses } from "@/lib/leads/queries";
import { businessesToCsv } from "@/lib/leads/csv";

export const GET = handle(async (req) => {
  const actor = await getActor();
  const f = { ...parseLeadFilters(req.nextUrl.searchParams), page: 1, pageSize: 200 };
  const rows: Awaited<ReturnType<typeof listBusinesses>>["items"] = [];
  for (;;) {
    const { items, total } = await listBusinesses(f, actor.id);
    rows.push(...items);
    if (rows.length >= total || items.length === 0) break;
    f.page++;
  }
  const csv = businessesToCsv(rows);
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="leads-${stamp}.csv"`,
    },
  });
});
