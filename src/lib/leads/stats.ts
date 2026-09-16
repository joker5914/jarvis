import { prisma } from "@/lib/db";

export async function getDashboardStats(ownerId: string) {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [totalLeads, greenLeads, projectsOpeningSoon, contactedRows] = await Promise.all([
    prisma.business.count({ where: { ownerId, exclusion: "none" } }),
    prisma.business.count({ where: { ownerId, exclusion: "none", contactQualityBand: "green" } }),
    prisma.project.count({ where: { ownerId, exclusion: "none", timingWindow: "opening_soon" } }),
    prisma.activityLog.findMany({
      where: { ownerId, kind: "status_changed", createdAt: { gte: weekAgo }, message: { contains: "contacted" } },
      select: { businessId: true },
      distinct: ["businessId"],
    }),
  ]);
  return { totalLeads, greenLeads, projectsOpeningSoon, contactedThisWeek: contactedRows.length };
}
