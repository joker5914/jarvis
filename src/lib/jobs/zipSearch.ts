import pLimit from "p-limit";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { CATEGORIES } from "@/lib/config/categories";
import { scoreSmbFit } from "@/lib/scoring/smbFit";
import { scoreContactQuality } from "@/lib/scoring/contactQuality";
import { suggestPackage } from "@/lib/scoring/packageMap";
import { extractWebsiteContacts } from "@/lib/extract/website";
import { normalizePhone } from "@/lib/extract/normalize";
import { BudgetExhaustedError } from "@/lib/providers/budget";
import type { DiscoveredBusiness } from "@/lib/providers/types";
import { DISCOVERY_CONFIG } from "@/lib/config/discovery";
import { checkPause, discoveredToBusinessFields, JobPausedError, normalizeName, type JobDeps } from "./shared";

/**
 * `signal` is aborted when pg-boss expires or cancels the underlying job (e.g. the job
 * ran past `expireInSeconds`, or the worker is shutting down). Treated like
 * a pause: the search is marked `paused` (resumable) rather than left
 * `running` forever while a retried job also processes the same searchId.
 */
export type ZipSearchDeps = JobDeps;
export { JobPausedError, normalizeName };

const SCRAPE_CONCURRENCY = 4;

type Progress = { step: string; current?: number; total?: number; message?: string; doneSteps: string[] };

async function setProgress(searchId: string, p: Progress) {
  await prisma.search.update({ where: { id: searchId }, data: { progress: p as Prisma.InputJsonValue } });
}

export async function recomputeContactQuality(businessId: string) {
  const b = await prisma.business.findUnique({ where: { id: businessId }, include: { contacts: true } });
  if (!b) return;
  const q = scoreContactQuality({ websiteReachable: b.websiteReachable, phone: b.phone, contacts: b.contacts });
  await prisma.business.update({
    where: { id: businessId },
    data: { contactQualityScore: q.score, contactQualityBand: q.band, contactQualityReasons: q.reasons },
  });
}

type Found = { biz: DiscoveredBusiness; category: string };
type KnownFresh = { placeId: string; category: string };

/** Per category: IDs-only search; details only for places we don't have or haven't refreshed recently. */
async function discover(searchId: string, ownerId: string, zip: string, center: { lat: number; lng: number }, radius: number, deps: ZipSearchDeps, done: string[]) {
  const idsByCategory = new Map<string, string>(); // placeId -> first surfacing category
  for (let i = 0; i < CATEGORIES.length; i++) {
    await checkPause(deps);
    const c = CATEGORIES[i];
    await setProgress(searchId, { step: "discover", current: i + 1, total: CATEGORIES.length, message: c.label, doneSteps: done });
    const ids = await deps.providers.discovery.searchCategoryIds(`${c.query} in ${zip}`, center, radius);
    for (const id of ids) if (id && !idsByCategory.has(id)) idsByCategory.set(id, c.slug);
  }

  const refreshBefore = new Date(Date.now() - DISCOVERY_CONFIG.detailsRefreshDays * 86_400_000);
  const existing = await prisma.business.findMany({
    where: { ownerId, googlePlaceId: { in: [...idsByCategory.keys()] } },
    select: { googlePlaceId: true, googleFetchedAt: true },
  });
  const fresh = new Set(existing.filter((b) => b.googleFetchedAt && b.googleFetchedAt > refreshBefore).map((b) => b.googlePlaceId!));
  const known = new Set(existing.map((b) => b.googlePlaceId!));

  const found = new Map<string, Found>();
  const toFetch = [...idsByCategory.keys()].filter((id) => !fresh.has(id));
  let n = 0;
  for (const id of toFetch) {
    await checkPause(deps);
    n++;
    await setProgress(searchId, { step: "details", current: n, total: toFetch.length, doneSteps: done });
    const biz = await deps.providers.discovery.getPlaceDetails(id);
    if (biz && biz.name) found.set(id, { biz, category: idsByCategory.get(id)! });
  }
  return { found, knownFresh: [...idsByCategory.keys()].filter((id) => fresh.has(id) && known.has(id)).map((id) => ({ placeId: id, category: idsByCategory.get(id)! })) };
}

/**
 * `upsert()` with `update: {}` is a no-op once the row exists, so a P2002 from a concurrent
 * writer racing the same upsert means the desired row is already there — safe to ignore rather
 * than fail the whole search.
 */
async function upsertIgnoringConflict<T>(fn: () => Promise<T>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
  }
}

async function upsertBusinesses(searchId: string, ownerId: string, found: Map<string, Found>, knownFresh: KnownFresh[]) {
  const nameCounts = new Map<string, number>();
  for (const { biz } of found.values()) {
    const n = normalizeName(biz.name);
    nameCounts.set(n, (nameCounts.get(n) ?? 0) + 1);
  }

  const ids: string[] = [];
  for (const { biz, category } of found.values()) {
    const fit = scoreSmbFit({ name: biz.name, sameNameCount: nameCounts.get(normalizeName(biz.name)) });
    const googleFields = {
      ...discoveredToBusinessFields(biz),
      googleFetchedAt: new Date(),
      exclusion: fit.excluded ? ("enterprise" as const) : ("none" as const),
      exclusionReasons: fit.exclusionReasons,
      smbFitScore: fit.score,
    };
    const existing = await prisma.business.findUnique({ where: { ownerId_googlePlaceId: { ownerId, googlePlaceId: biz.placeId } } });
    const updateExisting = (row: { id: string; primaryCategory: string | null; suggestedPackage: string | null }) =>
      prisma.business.update({
        where: { id: row.id },
        data: { ...googleFields, primaryCategory: row.primaryCategory ?? category, suggestedPackage: row.suggestedPackage ?? suggestPackage(category) },
      });
    let b;
    if (existing) {
      b = await updateExisting(existing);
    } else {
      try {
        b = await prisma.business.create({
          data: {
            ...googleFields,
            ownerId,
            googlePlaceId: biz.placeId,
            source: "zip_search",
            primaryCategory: category,
            suggestedPackage: suggestPackage(category),
            activity: { create: { ownerId, kind: "discovered", message: `Found via zip search as "${category}"` } },
          },
        });
      } catch (e) {
        // Two scanner/search jobs for the same owner can discover the same place concurrently
        // (e.g. overlapping zips surface the same fake-provider IDs); the loser of the create
        // race retries as an update against the row the winner just inserted.
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
          const winner = await prisma.business.findUnique({ where: { ownerId_googlePlaceId: { ownerId, googlePlaceId: biz.placeId } } });
          if (!winner) throw e;
          b = await updateExisting(winner);
        } else {
          throw e;
        }
      }
    }
    ids.push(b.id);

    await prisma.searchBusiness.upsert({
      where: { searchId_businessId: { searchId, businessId: b.id } },
      update: {},
      create: { searchId, businessId: b.id, surfacedByCategory: category },
    });
    const phone = biz.phone ? normalizePhone(biz.phone) : null;
    if (phone) {
      await upsertIgnoringConflict(() =>
        prisma.contact.upsert({
          where: { businessId_type_value: { businessId: b.id, type: "phone", value: phone } },
          update: {},
          create: { ownerId, businessId: b.id, type: "phone", value: phone, source: "google", validationStatus: "valid", validatedAt: new Date() },
        }),
      );
    }
    const systemTag = await prisma.tag.findUnique({ where: { ownerId_name: { ownerId, name: category } } });
    if (systemTag) {
      await upsertIgnoringConflict(() =>
        prisma.businessTag.upsert({
          where: { businessId_tagId: { businessId: b.id, tagId: systemTag.id } },
          update: {},
          create: { businessId: b.id, tagId: systemTag.id },
        }),
      );
    }
  }

  for (const { placeId, category } of knownFresh) {
    const existing = await prisma.business.findUnique({ where: { ownerId_googlePlaceId: { ownerId, googlePlaceId: placeId } } });
    if (!existing) continue;
    const b = existing.primaryCategory
      ? existing
      : await prisma.business.update({ where: { id: existing.id }, data: { primaryCategory: category, suggestedPackage: existing.suggestedPackage ?? suggestPackage(category) } });
    ids.push(b.id);

    await prisma.searchBusiness.upsert({
      where: { searchId_businessId: { searchId, businessId: b.id } },
      update: {},
      create: { searchId, businessId: b.id, surfacedByCategory: category },
    });
  }
  return ids;
}

export async function scrapeOne(businessId: string, ownerId: string, deps: ZipSearchDeps) {
  const b = await prisma.business.findUnique({ where: { id: businessId } });
  if (!b?.websiteUrl) return;
  const r = await extractWebsiteContacts(b.websiteUrl, deps.providers.fetcher);
  await prisma.business.update({
    where: { id: businessId },
    data: {
      websiteReachable: r.reachable,
      websiteError: r.error ?? null,
      websiteCheckedAt: new Date(),
      currentProviderHint: r.providerHint?.provider ?? b.currentProviderHint,
      currentProviderEvidence: r.providerHint?.evidence ?? b.currentProviderEvidence,
    },
  });
  const rows = [
    ...r.emails.map((v) => ({ type: "email" as const, value: v })),
    ...r.phones.map((v) => ({ type: "phone" as const, value: v })),
    ...r.socials.map((s) => ({ type: s.type, value: s.url })),
  ];
  for (const row of rows) {
    await prisma.contact.upsert({
      where: { businessId_type_value: { businessId, type: row.type, value: row.value } },
      update: {},
      create: { ownerId, businessId, type: row.type, value: row.value, source: "website" },
    });
  }
  await prisma.activityLog.create({
    data: {
      ownerId,
      businessId,
      kind: "scraped",
      message: r.reachable
        ? `Scraped ${r.pagesFetched.length} page(s): ${r.emails.length} email(s), ${r.phones.length} phone(s), ${r.socials.length} social link(s)`
        : `Website unreachable: ${r.error}`,
    },
  });
}

export async function validateEmails(businessIds: string[], deps: ZipSearchDeps) {
  const contacts = await prisma.contact.findMany({
    where: { businessId: { in: businessIds }, type: "email", validationStatus: "unchecked" },
  });
  const cache = new Map<string, boolean>();
  for (const c of contacts) {
    const domain = c.value.split("@")[1];
    let ok = cache.get(domain);
    if (ok === undefined) {
      ok = await deps.providers.validation.domainHasMx(domain);
      cache.set(domain, ok);
    }
    await prisma.contact.update({
      where: { id: c.id },
      data: { validationStatus: ok ? "valid" : "invalid", validatedAt: new Date() },
    });
  }
}

export async function runZipSearch(searchId: string, deps: ZipSearchDeps): Promise<void> {
  const log = deps.log ?? (() => {});
  const search = await prisma.search.findUnique({ where: { id: searchId } });
  if (!search) return;
  const ownerId = search.ownerId;
  const prior = (search.progress as Progress | null)?.doneSteps ?? [];
  const done = [...prior];

  try {
    await prisma.search.update({ where: { id: searchId }, data: { status: "running", error: null } });

    // 1. geocode
    let center = search.lat != null && search.lng != null ? { lat: search.lat, lng: search.lng } : null;
    let radius = search.radiusMeters ?? 3000;
    if (!center) {
      await setProgress(searchId, { step: "geocode", message: `Locating ${search.zip}`, doneSteps: done });
      const geo = await deps.providers.geocode.geocodeZip(search.zip);
      if (!geo) throw new Error(`Zip ${search.zip} could not be located`);
      center = { lat: geo.lat, lng: geo.lng };
      radius = geo.radiusMeters;
      await prisma.search.update({
        where: { id: searchId },
        data: { lat: geo.lat, lng: geo.lng, city: geo.city, state: geo.state, radiusMeters: geo.radiusMeters },
      });
    }

    // 2 to 4. discover + exclusion + upsert (skipped on resume)
    let businessIds: string[];
    if (!done.includes("discover")) {
      const { found, knownFresh } = await discover(searchId, ownerId, search.zip, center, radius, deps, done);
      await setProgress(searchId, { step: "save", current: 0, total: found.size + knownFresh.length, doneSteps: done });
      businessIds = await upsertBusinesses(searchId, ownerId, found, knownFresh);
      done.push("discover");
      await prisma.search.update({ where: { id: searchId }, data: { countsFound: businessIds.length } });
      log(`search ${searchId}: ${businessIds.length} businesses`);
    } else {
      const links = await prisma.searchBusiness.findMany({ where: { searchId }, select: { businessId: true } });
      businessIds = links.map((l) => l.businessId);
    }

    // 5. contact extraction (concurrency 4). Businesses scraped since this search started are skipped on resume.
    const toScrape = await prisma.business.findMany({
      where: {
        id: { in: businessIds },
        websiteUrl: { not: null },
        exclusion: "none",
        OR: [{ websiteCheckedAt: null }, { websiteCheckedAt: { lt: search.createdAt } }],
      },
      select: { id: true },
    });
    let scraped = 0;
    const limit = pLimit(SCRAPE_CONCURRENCY);
    await setProgress(searchId, { step: "scrape", current: 0, total: toScrape.length, doneSteps: done });
    await Promise.all(
      toScrape.map((b) =>
        limit(async () => {
          await checkPause(deps);
          try {
            await scrapeOne(b.id, ownerId, deps);
          } catch (e) {
            await prisma.business.update({
              where: { id: b.id },
              data: { websiteReachable: false, websiteError: (e as Error).message, websiteCheckedAt: new Date() },
            });
          }
          scraped++;
          await prisma.search.update({
            where: { id: searchId },
            data: { countsScraped: scraped, progress: { step: "scrape", current: scraped, total: toScrape.length, doneSteps: done } as Prisma.InputJsonValue },
          });
        }),
      ),
    );

    // 6. MX validation
    await checkPause(deps);
    await setProgress(searchId, { step: "validate", doneSteps: done });
    await validateEmails(businessIds, deps);

    // 7. quality
    await setProgress(searchId, { step: "score", doneSteps: done });
    for (const id of businessIds) await recomputeContactQuality(id);

    await prisma.search.update({
      where: { id: searchId },
      data: { status: "complete", progress: { step: "complete", doneSteps: [...done, "scrape", "validate", "score"] } as Prisma.InputJsonValue },
    });
    log(`search ${searchId}: complete`);
  } catch (e) {
    if (e instanceof JobPausedError) {
      await prisma.search.update({ where: { id: searchId }, data: { status: "paused", progress: { step: "paused", message: "Paused by user", doneSteps: done } as Prisma.InputJsonValue } });
      return;
    }
    if (e instanceof BudgetExhaustedError) {
      await prisma.search.update({ where: { id: searchId }, data: { status: "paused", error: e.message, progress: { step: "paused", message: e.message, doneSteps: done } as Prisma.InputJsonValue } });
      return;
    }
    const message = (e as Error).message ?? String(e);
    await prisma.search.update({ where: { id: searchId }, data: { status: "failed", error: message, progress: { step: "failed", message, doneSteps: done } as Prisma.InputJsonValue } });
    throw e;
  }
}
