import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { PROJECT_CONFIG } from "@/lib/config/projects";

const bool = z.enum(["true", "false"]).default("false").transform((v) => v === "true");
const optBool = z.enum(["true", "false"]).optional().transform((v) => (v === undefined ? undefined : v === "true"));

export const projectFiltersSchema = z.object({
  q: z.string().trim().min(1).optional(),
  zip: z.string().regex(/^\d{5}$/).optional(),
  workType: z.enum(["new_construction", "renovation", "addition", "historic", "row"]).optional(),
  timing: z.enum(["opening_soon", "under_construction", "planned", "just_completed", "stale"]).optional(),
  fit: z.enum(["high", "medium", "low"]).optional(),
  linked: optBool,
  showExcluded: bool,
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  sort: z.enum(["completion", "fit", "registered"]).default("completion"),
});

export type ProjectFilters = z.infer<typeof projectFiltersSchema>;

export function parseProjectFilters(sp: URLSearchParams): ProjectFilters {
  const raw: Record<string, string> = {};
  sp.forEach((v, k) => {
    if (v !== "") raw[k] = v;
  });
  return projectFiltersSchema.parse(raw);
}

export function buildProjectWhere(f: ProjectFilters, ownerId: string): Prisma.ProjectWhereInput {
  const where: Prisma.ProjectWhereInput = { ownerId };
  if (!f.showExcluded) where.exclusion = "none";
  if (f.q) {
    where.OR = [
      { projectName: { contains: f.q, mode: "insensitive" } },
      { facilityName: { contains: f.q, mode: "insensitive" } },
    ];
  }
  if (f.zip) where.zip = f.zip;
  if (f.workType) where.workType = f.workType;
  if (f.timing) where.timingWindow = f.timing;
  if (f.fit === "high") where.smbFitScore = { gte: PROJECT_CONFIG.highFitThreshold };
  if (f.fit === "medium")
    where.smbFitScore = { gte: PROJECT_CONFIG.mediumFitThreshold, lt: PROJECT_CONFIG.highFitThreshold };
  if (f.fit === "low") where.smbFitScore = { lt: PROJECT_CONFIG.mediumFitThreshold };
  if (f.linked === true) where.businessId = { not: null };
  if (f.linked === false) where.businessId = null;
  return where;
}

const byCompletion: Prisma.ProjectOrderByWithRelationInput = { completionDate: { sort: "asc", nulls: "last" } };

export function buildProjectOrderBy(f: ProjectFilters): Prisma.ProjectOrderByWithRelationInput[] {
  switch (f.sort) {
    case "fit":
      return [{ smbFitScore: "desc" }, byCompletion];
    case "registered":
      return [{ registrationDate: "desc" }];
    default:
      return [byCompletion, { smbFitScore: "desc" }];
  }
}
