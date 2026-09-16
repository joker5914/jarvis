import Link from "next/link";
import { prisma } from "@/lib/db";
import { getActor } from "@/lib/actor";
import { getDashboardStats } from "@/lib/leads/stats";
import { formatDate, timeAgo } from "@/lib/format";
import { StatTile } from "@/components/dashboard/StatTile";
import { ScannerCard } from "@/components/dashboard/ScannerCard";
import { ZipSearchForm } from "@/components/searches/ZipSearchForm";
import { SearchStatusBadge } from "@/components/searches/SearchStatusBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const actor = await getActor();
  const [stats, recent, hot] = await Promise.all([
    getDashboardStats(actor.id),
    prisma.search.findMany({ where: { ownerId: actor.id }, orderBy: { createdAt: "desc" }, take: 5 }),
    prisma.project.findMany({
      where: { ownerId: actor.id, exclusion: "none", timingWindow: { in: ["opening_soon", "under_construction"] } },
      orderBy: { completionDate: "asc" },
      take: 5,
    }),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Find SMB leads by zip code and track outreach.</p>
        </div>
        <ZipSearchForm />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Total leads" value={stats.totalLeads} />
        <StatTile label="Green contact quality" value={stats.greenLeads} hint="ready to reach out" />
        <StatTile label="Opening in 60 days" value={stats.projectsOpeningSoon} hint="from TDLR projects" />
        <StatTile label="Contacted this week" value={stats.contactedThisWeek} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Recent searches</CardTitle>
            <Link href="/searches" className="text-sm text-blue-600 hover:underline">All searches</Link>
          </CardHeader>
          <CardContent>
            {recent.length === 0 ? (
              <p className="text-sm text-muted-foreground">No searches yet. Enter a zip code above.</p>
            ) : (
              <ul className="divide-y">
                {recent.map((s) => (
                  <li key={s.id} className="flex items-center justify-between py-2 text-sm">
                    <div>
                      <Link href={`/leads?searchId=${s.id}`} className="font-medium hover:underline">
                        {s.zip}{s.city ? ` · ${s.city}` : ""}
                      </Link>
                      <div className="text-xs text-muted-foreground">{timeAgo(s.createdAt)} · {s.countsFound} found</div>
                    </div>
                    <SearchStatusBadge status={s.status} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Hot projects</CardTitle>
            <Link href="/projects" className="text-sm text-blue-600 hover:underline">All projects</Link>
          </CardHeader>
          <CardContent>
            {hot.length === 0 ? (
              <p className="text-sm text-muted-foreground">No projects yet. Run a sync from the Projects page.</p>
            ) : (
              <ul className="divide-y">
                {hot.map((p) => (
                  <li key={p.id} className="py-2 text-sm">
                    <div className="font-medium">{p.projectName}</div>
                    <div className="text-xs text-muted-foreground">{p.zip} · completes {formatDate(p.completionDate)}</div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <ScannerCard ownerId={actor.id} />
      </div>
    </div>
  );
}
