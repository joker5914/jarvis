import pLimit from "p-limit";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { CATEGORIES } from "@/lib/config/categories";
import { scoreSmbFit } from "@/lib/scoring/smbFit";
import { scoreContactQuality } from "@/lib/scoring/contactQuality";
import { suggestPackage } from "@/lib/scoring/packageMap";
import { extractWebsiteContacts } from "@/lib/extract/website";
import { normalizePhone } from "@/lib/extract/normalize";
import { BudgetExhaustedError } from "@/lib/providers/budget";
import type { DiscoveredBusiness, Providers } from "@/lib/providers/types";

export type ZipSearchDeps = {
  providers: Providers;
  shouldPause?: () => Promise<boolean>;
  log?: (msg: string) => void;
  /**
   * Aborted when pg-boss expires or cancels the underlying job (e.g. the job
   * ran past `expireInSeconds`, or the worker is shutting down). Treated like
   * a pause: the search is marked `paused` (resumable) rather than left
   * `running` forever while a retried job also processes the same searchId.
   */
  signal?: AbortSignal;
};

export class JobPausedError extends Error {
  constructor() {
    super("paused");
    this.name = "JobPausedError";
  }
}

const SCRAPE_CONCURRENCY = 4;
const SUFFIX_RE = /\b(llc|inc|co|corp|ltd|pllc|pc)\b\.?/g;

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/'/g, "")
    .replace(SUFFIX_RE, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

type Progress = { step: string; current?: number; total?: number; message?: string; doneSteps: string[] };

async function setProgress(searchId: string, p: Progress) {
  await prisma.search.update({ where: { id: searchId }, data: { progress: p as Prisma.InputJsonValue } });
}

async function checkPause(deps: ZipSearchDeps) {
  if (deps.signal?.aborted) throw new JobPausedError();
  if (deps.shouldPause && (await deps.shouldPause())) throw new JobPausedError();
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

async function discover(searchId: string, zip: string, center: { lat: number; lng: number }, radius: number, deps: ZipSearchDeps, done: string[]) {
  const found = new Map<string, Found>();
  for (let i = 0; i < CATEGORIES.length; i++) {
    await checkPause(deps);
    const c = CATEGORIES[i];
    await setProgress(searchId, { step: "discover", current: i + 1, total: CATEGORIES.length, message: c.label, doneSteps: done });
    const results = await deps.providers.discovery.searchCategory(`${c.query} in ${zip}`, center, radius);
    for (const biz of results) {
      if (!biz.placeId || !biz.name) continue;
      if (!found.has(biz.placeId)) found.set(biz.placeId, { biz, category: c.slug });
    }
  }
  return found;
}

async function upsertBusinesses(searchId: string, ownerId: string, found: Map<string, Found>) {
  const nameCounts = new Map<string, number>();
  for (const { biz } of found.values()) {
    const n = normalizeName(biz.name);
    nameCounts.set(n, (nameCounts.get(n) ?? 0) + 1);
  }

  const ids: string[] = [];
  for (const { biz, category } of found.values()) {
    const fit = scoreSmbFit({ name: biz.name, sameNameCount: nameCounts.get(normalizeName(biz.name)) });
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
      exclusion: fit.excluded ? ("enterprise" as const) : ("none" as const),
      exclusionReasons: fit.exclusionReasons,
      smbFitScore: fit.score,
    };
    const existing = await prisma.business.findUnique({ where: { ownerId_googlePlaceId: { ownerId, googlePlaceId: biz.placeId } } });
    const b = existing
      ? await prisma.business.update({
          where: { id: existing.id },
          data: { ...googleFields, primaryCategory: existing.primaryCategory ?? category, suggestedPackage: existing.suggestedPackage ?? suggestPackage(category) },
        })
      : await prisma.business.create({
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
    ids.push(b.id);

    await prisma.searchBusiness.upsert({
      where: { searchId_businessId: { searchId, businessId: b.id } },
      update: {},
      create: { searchId, businessId: b.id, surfacedByCategory: category },
    });
    const phone = biz.phone ? normalizePhone(biz.phone) : null;
    if (phone) {
      await prisma.contact.upsert({
        where: { businessId_type_value: { businessId: b.id, type: "phone", value: phone } },
        update: {},
        create: { ownerId, businessId: b.id, type: "phone", value: phone, source: "google", validationStatus: "valid", validatedAt: new Date() },
      });
    }
    const systemTag = await prisma.tag.findUnique({ where: { ownerId_name: { ownerId, name: category } } });
    if (systemTag) {
      await prisma.businessTag.upsert({
        where: { businessId_tagId: { businessId: b.id, tagId: systemTag.id } },
        update: {},
        create: { businessId: b.id, tagId: systemTag.id },
      });
    }
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
      const found = await discover(searchId, search.zip, center, radius, deps, done);
      await setProgress(searchId, { step: "save", current: 0, total: found.size, doneSteps: done });
      businessIds = await upsertBusinesses(searchId, ownerId, found);
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
