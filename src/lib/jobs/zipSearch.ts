import pLimit from "p-limit";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { Category } from "@/lib/config/categories";
import { loadConfig, type RuntimeConfig } from "@/lib/config/runtime";
import { scoreSmbFit } from "@/lib/scoring/smbFit";
import { scoreContactQuality } from "@/lib/scoring/contactQuality";
import { suggestPackage } from "@/lib/scoring/packageMap";
import { extractWebsiteContacts } from "@/lib/extract/website";
import { normalizePhone } from "@/lib/extract/normalize";
import { BudgetExhaustedError } from "@/lib/providers/budget";
import type { DiscoveredBusiness } from "@/lib/providers/types";
import { DISCOVERY_CONFIG } from "@/lib/config/discovery";
import { checkPause, discoveredToBusinessFields, JobPausedError, normalizeName, upsertIgnoringConflict, type JobDeps } from "./shared";

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
async function discover(searchId: string, ownerId: string, zip: string, center: { lat: number; lng: number }, radius: number, deps: ZipSearchDeps, done: string[], categories: Category[]) {
  const idsByCategory = new Map<string, string>(); // placeId -> first surfacing category
  for (let i = 0; i < categories.length; i++) {
    await checkPause(deps);
    const c = categories[i];
    await setProgress(searchId, { step: "discover", current: i + 1, total: categories.length, message: c.label, doneSteps: done });
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
    if (biz && biz.name) {
      found.set(id, { biz, category: idsByCategory.get(id)! });
      // Persist the Business row as soon as its details are fetched, not just after the whole
      // discover() batch finishes: if a BudgetExhaustedError (or a pause) interrupts the loop
      // partway through, the places already fetched are safe on disk, so a resumed search sees
      // them via `existing`/`fresh` above (as `knownFresh`) instead of re-spending budget on a
      // repeat getPlaceDetails call. Not linked to the search yet (searchBusiness rows are
      // created below in upsertBusinesses), and `primaryCategory` is deliberately left unset:
      // it doubles as the "never scored" marker upsertBusinesses uses to run exclusion/scoring
      // exactly once, whether that happens later in this same run (via `found`) or in a
      // resumed run (via `knownFresh`).
      //
      // The nested `activity: { create: ... } }` under `create:` only fires when this upsert
      // actually inserts the row (Prisma does not run it on the update path), so the
      // "discovered" ActivityLog entry is written exactly once, right when the business is
      // first known — including under a concurrent-search race, where `upsertIgnoringConflict`
      // discards the whole losing call (business fields and nested activity together) on P2002
      // rather than leaving a partial write.
      await upsertIgnoringConflict(() =>
        prisma.business.upsert({
          where: { ownerId_googlePlaceId: { ownerId, googlePlaceId: biz.placeId } },
          update: { ...discoveredToBusinessFields(biz), googleFetchedAt: new Date() },
          create: {
            ...discoveredToBusinessFields(biz),
            ownerId,
            googlePlaceId: biz.placeId,
            source: "zip_search",
            googleFetchedAt: new Date(),
            activity: { create: { ownerId, kind: "discovered", message: `Found via zip search as "${idsByCategory.get(id)}"` } },
          },
        }),
      );
    }
  }
  return { found, knownFresh: [...idsByCategory.keys()].filter((id) => fresh.has(id) && known.has(id)).map((id) => ({ placeId: id, category: idsByCategory.get(id)! })) };
}

async function upsertBusinesses(searchId: string, ownerId: string, found: Map<string, Found>, knownFresh: KnownFresh[], cfg: RuntimeConfig) {
  // Fetch the knownFresh rows once, up front: they're needed both for the chain-name count
  // below and for the knownFresh linking loop further down, replacing what used to be a
  // second findUnique per place there.
  const knownFreshExisting = knownFresh.length
    ? await prisma.business.findMany({
        where: { ownerId, googlePlaceId: { in: knownFresh.map((k) => k.placeId) } },
        select: { id: true, googlePlaceId: true, name: true, primaryCategory: true, suggestedPackage: true },
      })
    : [];
  const knownFreshByPlaceId = new Map(knownFreshExisting.map((b) => [b.googlePlaceId!, b]));

  const nameCounts = new Map<string, number>();
  for (const { biz } of found.values()) {
    const n = normalizeName(biz.name);
    nameCounts.set(n, (nameCounts.get(n) ?? 0) + 1);
  }
  // A search that was interrupted mid-discover() (F4: budget-pause resume) now persists
  // Business rows for places as they're fetched, so on resume some places that would have
  // been in `found` in one uninterrupted run instead show up as `knownFresh` here. Counting
  // their names too keeps the same-name (chain) exclusion identical either way.
  for (const b of knownFreshExisting) {
    const n = normalizeName(b.name);
    nameCounts.set(n, (nameCounts.get(n) ?? 0) + 1);
  }

  const ids: string[] = [];
  for (const { biz, category } of found.values()) {
    const fit = scoreSmbFit({ name: biz.name, sameNameCount: nameCounts.get(normalizeName(biz.name)) }, cfg.exclusion, cfg.projects);
    const googleFields = {
      ...discoveredToBusinessFields(biz),
      googleFetchedAt: new Date(),
      exclusion: fit.excluded ? ("enterprise" as const) : ("none" as const),
      exclusionReasons: fit.exclusionReasons,
      smbFitScore: fit.score,
    };
    // discover() already upserted this Business row (immediately after fetching its Place
    // Details, including the one-time "discovered" ActivityLog entry — see the comment there),
    // so `existing` is always found here now; there's nothing left to create.
    const existing = await prisma.business.findUnique({ where: { ownerId_googlePlaceId: { ownerId, googlePlaceId: biz.placeId } } });
    if (!existing) throw new Error(`Business row for place ${biz.placeId} is missing; discover() should have persisted it`);
    const b = await prisma.business.update({
      where: { id: existing.id },
      data: { ...googleFields, primaryCategory: existing.primaryCategory ?? category, suggestedPackage: existing.suggestedPackage ?? suggestPackage(category, undefined, cfg.categories) },
    });
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
    const existing = knownFreshByPlaceId.get(placeId);
    if (!existing) continue;
    let b;
    if (existing.primaryCategory === null) {
      // `primaryCategory === null` is the "never scored" marker discover() leaves on a row it
      // persists (R2): this place was fetched and saved by an earlier, interrupted run of this
      // search (F4) and became `knownFresh` on resume, but never went through the scoring pass
      // below because that interrupted run never reached it. Run that scoring pass now, off
      // the same merged `nameCounts` `found` rows use above, so exclusion/smbFitScore come out
      // identical whether or not the search was interrupted.
      const fit = scoreSmbFit({ name: existing.name, sameNameCount: nameCounts.get(normalizeName(existing.name)) }, cfg.exclusion, cfg.projects);
      b = await prisma.business.update({
        where: { id: existing.id },
        data: {
          primaryCategory: category,
          suggestedPackage: existing.suggestedPackage ?? suggestPackage(category, undefined, cfg.categories),
          exclusion: fit.excluded ? ("enterprise" as const) : ("none" as const),
          exclusionReasons: fit.exclusionReasons,
          smbFitScore: fit.score,
        },
      });
    } else {
      b = existing;
    }
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
  const r = await extractWebsiteContacts(b.websiteUrl, deps.providers.fetcher, { beforeFetch: () => checkPause(deps) });
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
    // Two concurrent scrapes of the same business (e.g. a scanner search and a manual rerun)
    // can race this upsert on the same (businessId, type, value) key; without tolerating the
    // loser's P2002 here, that race would bubble up through runZipSearch's per-business catch
    // in the caller and get recorded as `websiteReachable: false` with a unique-constraint
    // message even though the scrape itself succeeded.
    await upsertIgnoringConflict(() =>
      prisma.contact.upsert({
        where: { businessId_type_value: { businessId, type: row.type, value: row.value } },
        update: {},
        create: { ownerId, businessId, type: row.type, value: row.value, source: "website" },
      }),
    );
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
    const cfg = await loadConfig(ownerId);

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
      const { found, knownFresh } = await discover(searchId, ownerId, search.zip, center, radius, deps, done, cfg.categories);
      await setProgress(searchId, { step: "save", current: 0, total: found.size + knownFresh.length, doneSteps: done });
      businessIds = await upsertBusinesses(searchId, ownerId, found, knownFresh, cfg);
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
