import { z } from "zod";
import type { Prisma } from "@prisma/client";

const bool = z.enum(["true", "false"]).default("false").transform((v) => v === "true");

export const leadFiltersSchema = z.object({
  q: z.string().trim().min(1).optional(),
  category: z.string().optional(),
  zip: z.string().regex(/^\d{5}$/).optional(),
  source: z.enum(["zip_search", "tdlr", "manual"]).optional(),
  quality: z.enum(["green", "yellow", "red"]).optional(),
  status: z.enum(["not_contacted", "contacted", "interested", "not_a_fit", "customer"]).optional(),
  tag: z.string().optional(),
  product: z.string().optional(),
  timing: z.enum(["opening_soon", "under_construction", "planned", "just_completed", "stale"]).optional(),
  searchId: z.string().optional(),
  showExcluded: bool,
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  sort: z.enum(["quality", "name", "updated"]).default("quality"),
});

export type LeadFilters = z.infer<typeof leadFiltersSchema>;

export function parseLeadFilters(sp: URLSearchParams): LeadFilters {
  const raw: Record<string, string> = {};
  sp.forEach((v, k) => {
    if (v !== "") raw[k] = v;
  });
  return leadFiltersSchema.parse(raw);
}

export function buildBusinessWhere(f: LeadFilters, ownerId: string): Prisma.BusinessWhereInput {
  const where: Prisma.BusinessWhereInput = { ownerId };
  if (!f.showExcluded) where.exclusion = "none";
  if (f.q) where.name = { contains: f.q, mode: "insensitive" };
  if (f.category) where.primaryCategory = f.category;
  if (f.zip) where.zip = f.zip;
  if (f.source) where.source = f.source;
  if (f.quality) where.contactQualityBand = f.quality;
  if (f.status) where.outreachStatus = f.status;
  if (f.tag) where.tags = { some: { tag: { name: f.tag } } };
  if (f.product) where.productsPitched = { has: f.product };
  if (f.searchId) where.searches = { some: { searchId: f.searchId } };
  if (f.timing) where.projects = { some: { timingWindow: f.timing } };
  return where;
}

export function buildBusinessOrderBy(f: LeadFilters): Prisma.BusinessOrderByWithRelationInput[] {
  switch (f.sort) {
    case "name":
      return [{ name: "asc" }];
    case "updated":
      return [{ updatedAt: "desc" }];
    default:
      return [{ contactQualityScore: "desc" }, { name: "asc" }];
  }
}
