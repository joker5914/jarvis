import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { buildBusinessOrderBy, buildBusinessWhere, type LeadFilters } from "./filters";

export const leadInclude = {
  contacts: {
    select: { id: true, type: true, value: true, personName: true, personTitle: true, validationStatus: true, source: true },
    orderBy: { type: "asc" as const },
  },
  tags: { include: { tag: true } },
} satisfies Prisma.BusinessInclude;

export type LeadRow = Prisma.BusinessGetPayload<{ include: typeof leadInclude }>;

export async function listBusinesses(f: LeadFilters, ownerId: string) {
  const where = buildBusinessWhere(f, ownerId);
  const [items, total] = await Promise.all([
    prisma.business.findMany({
      where,
      include: leadInclude,
      orderBy: buildBusinessOrderBy(f),
      skip: (f.page - 1) * f.pageSize,
      take: f.pageSize,
    }),
    prisma.business.count({ where }),
  ]);
  return { items, total };
}

export async function getBusinessDetail(id: string, ownerId: string) {
  return prisma.business.findFirst({
    where: { id, ownerId },
    include: {
      ...leadInclude,
      activity: { orderBy: { createdAt: "desc" }, take: 50 },
      projects: true,
    },
  });
}
