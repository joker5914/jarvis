import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { buildProjectOrderBy, buildProjectWhere, type ProjectFilters, type ProjectFitThresholds } from "./filters";

export const projectInclude = {
  business: { select: { id: true, name: true, contactQualityBand: true, outreachStatus: true } },
} satisfies Prisma.ProjectInclude;

export type ProjectRow = Prisma.ProjectGetPayload<{ include: typeof projectInclude }>;

export async function listProjects(f: ProjectFilters, ownerId: string, thresholds?: ProjectFitThresholds) {
  const where = buildProjectWhere(f, ownerId, thresholds);
  const [items, total] = await Promise.all([
    prisma.project.findMany({ where, include: projectInclude, orderBy: buildProjectOrderBy(f), skip: (f.page - 1) * f.pageSize, take: f.pageSize }),
    prisma.project.count({ where }),
  ]);
  return { items, total };
}

export async function getProjectDetail(id: string, ownerId: string) {
  return prisma.project.findFirst({
    where: { id, ownerId },
    include: { ...projectInclude, activity: { orderBy: { createdAt: "desc" }, take: 50 } },
  });
}
