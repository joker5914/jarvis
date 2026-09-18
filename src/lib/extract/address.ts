// regionFromAddress and cityFromAddress, pulled out of src/lib/jobs/enrich.ts (Plan 10 Task 4,
// same move as domainFromUrl before it — see src/lib/extract/domains.ts's doc comment): that
// module imports prisma, so it can't be pulled into a client bundle. src/lib/leads/manualAssists.ts
// needs the lead's city (never a region literal — see the plan's Global Constraints) to build its
// owner-search links, and is itself a pure module used from a client component
// (src/components/leads/ManualAssists.tsx). enrich.ts re-exports both from here so its existing
// server-side callers and tests (importing from "@/lib/jobs/enrich") are unaffected.

/**
 * Splits a formatted street address into its city and 2-letter state code, the way Google's
 * formatted_address strings lay them out ("street, city, ST zip[, country]"). Supersedes the
 * plain city-only cityFromAddress (kept below as a thin wrapper — other code and tests still use
 * it): the location cascade in searchPeople needs both to build Apollo's `person_locations[]`
 * filter (see src/lib/providers/apollo.ts and src/lib/geo/usStates.ts).
 */
export function regionFromAddress(addr: string | null): { city: string | null; state: string | null } {
  if (!addr) return { city: null, state: null };
  const parts = addr.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length <= 1) return { city: null, state: null };
  const last = parts[parts.length - 1];
  const isCountry = /^(usa|united states|us)$/i.test(last);
  const stateZipIdx = isCountry ? parts.length - 2 : parts.length - 1;
  const cityRaw = parts[stateZipIdx - 1];
  const city = cityRaw && !/\d/.test(cityRaw) ? cityRaw : null;
  const stateZip = parts[stateZipIdx] as string | undefined;
  const stateMatch = stateZip ? /^([A-Z]{2})\b/.exec(stateZip) : null;
  return { city, state: stateMatch ? stateMatch[1] : null };
}

export function cityFromAddress(addr: string | null): string | null {
  return regionFromAddress(addr).city;
}
