import { prisma } from "@/lib/db";
import type { DiscoveredBusiness, Providers } from "@/lib/providers/types";

/** Dependencies every background job receives. Manual runs pass only `providers`. */
export type JobDeps = {
  providers: Providers;
  shouldPause?: () => Promise<boolean>;
  signal?: AbortSignal;
  log?: (msg: string) => void;
};

export class JobPausedError extends Error {
  constructor() {
    super("paused");
    this.name = "JobPausedError";
  }
}

/** Call between steps and before each network fetch so a pause lands within seconds. */
export async function checkPause(deps: JobDeps): Promise<void> {
  if (deps.signal?.aborted) throw new JobPausedError();
  if (deps.shouldPause && (await deps.shouldPause())) throw new JobPausedError();
}

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

/** The Business columns that come straight from Google. Used by zip search and promote. */
export function discoveredToBusinessFields(biz: DiscoveredBusiness) {
  return {
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
}

/** shouldPause for scanner-origin jobs: true once the user has asked the Scanner to pause. */
export function scannerPauseCheck(ownerId: string): () => Promise<boolean> {
  return async () => {
    const s = await prisma.scannerState.findUnique({ where: { ownerId }, select: { pauseRequested: true } });
    return !!s?.pauseRequested;
  };
}
