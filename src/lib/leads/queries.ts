import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { buildBusinessOrderBy, buildBusinessWhere, type LeadFilters } from "./filters";

export const leadInclude = {
  contacts: {
    // apolloId (Plan 10 Task 1): links an Apollo-sourced row back to the candidate it was
    // revealed from — needed once People/PATCH suppression (Task 3) has to find and remove
    // exactly one revealed person's rows.
    select: { id: true, type: true, value: true, personName: true, personTitle: true, validationStatus: true, source: true, apolloId: true },
    orderBy: { type: "asc" as const },
  },
  tags: { include: { tag: true } },
  projects: { select: { id: true, timingWindow: true, completionDate: true }, orderBy: { completionDate: "asc" as const }, take: 1 },
} satisfies Prisma.BusinessInclude;

// Plan 10 Task 1 (fix round, R1): the free candidate list and the Apollo suppression list are
// detail-only data — no list/table/CSV-export code reads them, and shipping every row's
// candidate JSON over the wire on every page load (and into the export) would only add weight
// for nothing anyone renders. `include` alone doesn't restrict Business's own scalar columns
// (Prisma returns every scalar unless `select`/`omit` narrows them), so the list query needs its
// own `omit`; `getBusinessDetail` below has no such omit, so the lead drawer still gets all five.
//
// Task 3 amendment: `primaryPerson` comes back OUT of this omit — the Leads table's contact
// column (LeadsTable.tsx) needs the manually-set primary contact's name to show it first, and
// that's ordinary scalar data (a name), not the candidate JSON this omit exists to keep off the
// wire. `primaryPersonTitle` stays omitted alongside `candidates`/`candidatesAt`/
// `suppressedApolloIds`: nothing in the list/table/CSV path reads a title, only the lead drawer's
// synthesized-row fallback (see LeadDetail.tsx's `groupPeople`) does.
const listOnlyOmit = { candidates: true, candidatesAt: true, primaryPersonTitle: true, suppressedApolloIds: true } as const satisfies Prisma.BusinessOmit;

export type LeadRow = Prisma.BusinessGetPayload<{ include: typeof leadInclude; omit: typeof listOnlyOmit }>;

export async function listBusinesses(f: LeadFilters, ownerId: string) {
  const where = buildBusinessWhere(f, ownerId);
  const [items, total] = await Promise.all([
    prisma.business.findMany({
      where,
      include: leadInclude,
      omit: listOnlyOmit,
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
