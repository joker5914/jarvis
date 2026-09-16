import { prisma } from "@/lib/db";
import { getActor } from "@/lib/actor";
import { PROJECT_CONFIG } from "@/lib/config/projects";
import { normalizePhone } from "@/lib/extract/normalize";
import { suggestPackage } from "@/lib/scoring/packageMap";
import type { DiscoveredBusiness, Providers } from "@/lib/providers/types";
import type { Project } from "@prisma/client";
import { JobPausedError, normalizeName, recomputeContactQuality, scrapeOne, validateEmails, type ZipSearchDeps } from "./zipSearch";
import { readSync, SYNC_KEYS, writeSync } from "./syncStatus";

export type PromoteDeps = {
  providers: Providers;
  shouldPause?: () => Promise<boolean>;
  signal?: AbortSignal;
  log?: (msg: string) => void;
};

export type FindResult = { auto: DiscoveredBusiness | null; candidates: DiscoveredBusiness[] };

const HOUSTON_CENTER = { lat: 29.7604, lng: -95.3698 };
const SEARCH_RADIUS_M = 5000;

async function checkPause(deps: PromoteDeps) {
  if (deps.signal?.aborted) throw new JobPausedError();
  if (deps.shouldPause && (await deps.shouldPause())) throw new JobPausedError();
}

function tokens(s: string): Set<string> {
  return new Set(normalizeName(s).split(" ").filter(Boolean));
}

/** Jaccard similarity of name tokens after normalizeName (case, punctuation, LLC/Inc suffixes). */
export function nameSimilarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

function displayName(p: Project): string {
  return p.facilityName?.trim() || p.projectName;
}

async function ownedProject(projectId: string, ownerId: string): Promise<Project> {
  const p = await prisma.project.findFirst({ where: { id: projectId, ownerId } });
  if (!p) throw new Error("Project not found");
  return p;
}

export async function findBusinessCandidates(projectId: string, ownerId: string, deps: PromoteDeps): Promise<FindResult> {
  const p = await ownedProject(projectId, ownerId);
  const name = displayName(p);
  const geo = p.zip ? await deps.providers.geocode.geocodeZip(p.zip) : null;
  const center = geo ? { lat: geo.lat, lng: geo.lng } : HOUSTON_CENTER;
  const query = [name, p.locationAddress, p.zip].filter(Boolean).join(" ");
  const results = await deps.providers.discovery.searchCategory(query, center, SEARCH_RADIUS_M, 5);
  const top = results[0];
  const auto =
    top && p.zip && top.zip === p.zip && nameSimilarity(name, top.name) >= PROJECT_CONFIG.autoLinkSimilarity ? top : null;
  return { auto, candidates: results.slice(0, 3) };
}

async function attachOwnerPhone(businessId: string, ownerId: string, p: Project) {
  const phone = p.ownerPhone ? normalizePhone(p.ownerPhone) : null;
  if (!phone) return;
  await prisma.contact.upsert({
    where: { businessId_type_value: { businessId, type: "phone", value: phone } },
    update: { personName: p.contactName ?? p.ownerName ?? undefined },
    create: {
      ownerId,
      businessId,
      type: "phone",
      value: phone,
      source: "tdlr",
      personName: p.contactName ?? p.ownerName ?? null,
      validationStatus: "valid",
      validatedAt: new Date(),
    },
  });
}

async function finishLink(businessId: string, ownerId: string, p: Project, how: string) {
  await prisma.project.update({ where: { id: p.id }, data: { businessId } });
  await attachOwnerPhone(businessId, ownerId, p);
  await prisma.activityLog.create({
    data: { ownerId, businessId, projectId: p.id, kind: "promoted", message: `${how} TDLR project ${p.projectNumber}` },
  });
  await recomputeContactQuality(businessId);
}

export async function linkProjectToPlace(projectId: string, ownerId: string, biz: DiscoveredBusiness): Promise<string> {
  const p = await ownedProject(projectId, ownerId);
  const googleFields = {
    name: biz.name,
    formattedAddress: biz.formattedAddress,
    zip: biz.zip,
    lat: biz.lat,
    lng: biz.lng,
    phone: biz.phone,
    websiteUrl: biz.websiteUrl,
    googleRating: biz.rating,
    googleReviewCount: biz.reviewCount,
    googleTypes: biz.types,
  };
  const existing = await prisma.business.findUnique({ where: { ownerId_googlePlaceId: { ownerId, googlePlaceId: biz.placeId } } });
  const business = existing
    ? await prisma.business.update({ where: { id: existing.id }, data: googleFields })
    : await prisma.business.create({
        data: {
          ...googleFields,
          ownerId,
          googlePlaceId: biz.placeId,
          source: "tdlr",
          smbFitScore: p.smbFitScore,
          suggestedPackage: suggestPackage(null, p.workType),
        },
      });
  await finishLink(business.id, ownerId, p, existing ? "Linked existing business to" : "Created business from Google match for");
  return business.id;
}

export async function createBusinessFromProject(projectId: string, ownerId: string): Promise<string> {
  const p = await ownedProject(projectId, ownerId);
  if (p.businessId) return p.businessId;
  const cityLine = [p.city, "TX"].filter(Boolean).join(", ");
  const formattedAddress = [p.locationAddress, cityLine, p.zip].filter(Boolean).join(", ").replace(", " + p.zip, ` ${p.zip}`);
  const business = await prisma.business.create({
    data: {
      ownerId,
      name: displayName(p),
      formattedAddress: formattedAddress || null,
      zip: p.zip,
      source: "tdlr",
      exclusion: p.exclusion,
      exclusionReasons: p.exclusionReasons,
      smbFitScore: p.smbFitScore,
      suggestedPackage: suggestPackage(null, p.workType),
    },
  });
  await finishLink(business.id, ownerId, p, "Created business from");
  return business.id;
}

/** Scrape + validate + score one business (same steps as the zip search pipeline). */
export async function runPromoteBusiness(businessId: string, ownerId: string, deps: PromoteDeps): Promise<void> {
  const zdeps: ZipSearchDeps = { providers: deps.providers, shouldPause: deps.shouldPause, signal: deps.signal, log: deps.log };
  await scrapeOne(businessId, ownerId, zdeps);
  await validateEmails([businessId], zdeps);
  await recomputeContactQuality(businessId);
}

export async function runPromoteHighFit(deps: PromoteDeps) {
  const { id: ownerId } = await getActor();
  const counts = { considered: 0, linked: 0, skipped: 0 };
  const projects = await prisma.project.findMany({
    where: { ownerId, businessId: null, exclusion: "none", smbFitScore: { gte: PROJECT_CONFIG.highFitThreshold } },
    orderBy: [{ completionDate: { sort: "asc", nulls: "last" } }],
    select: { id: true, projectNumber: true },
  });
  const startedAt = new Date().toISOString();
  try {
    for (const p of projects) {
      await checkPause(deps);
      counts.considered++;
      await writeSync(SYNC_KEYS.promoteBatch, { status: "running", startedAt, current: counts.considered, total: projects.length, message: `Matching ${p.projectNumber}`, counts });
      const found = await findBusinessCandidates(p.id, ownerId, deps);
      if (!found.auto) {
        counts.skipped++;
        continue;
      }
      const businessId = await linkProjectToPlace(p.id, ownerId, found.auto);
      await runPromoteBusiness(businessId, ownerId, deps);
      counts.linked++;
    }
    await writeSync(SYNC_KEYS.promoteBatch, { status: "idle", finishedAt: new Date().toISOString(), counts, error: null }, new Date());
    return counts;
  } catch (e) {
    if (e instanceof JobPausedError) {
      await writeSync(SYNC_KEYS.promoteBatch, { status: "paused", message: "Paused", counts });
      return counts;
    }
    await writeSync(SYNC_KEYS.promoteBatch, { status: "failed", error: (e as Error).message ?? String(e), counts });
    throw e;
  }
}

export { readSync as readPromoteBatchStatus };
