/**
 * Apollo people enrichment defaults (spec 5.2, Plan 7 credit strategy): one decision-maker
 * revealed per business by default. The user is on a paid Apollo plan with 2,500 credits/month
 * (Plan 9), so `monthlyCreditCapDefault` stays conservative — the app's own cap defaults to 80
 * until the user raises it in Settings, and `monthlyCreditCapMax` (5,000) is just the ceiling on
 * how high they're allowed to raise it, not a target. `maxPeople` is a default that
 * Settings/the caller can raise up to `maxPeopleLimit`.
 */
export const ENRICH_CONFIG = {
  maxPeople: 1,
  maxPeopleLimit: 5,
  // People Search itself costs no Apollo credits (only the later per-person reveal does), so
  // request a full page and rank locally rather than asking Apollo for just `max` rows — its own
  // ordering isn't the "best candidate" ordering we want (see Plan 8 Task 7).
  searchPageSize: 10,
  monthlyCreditCap: 85,
  monthlyCreditCapDefault: 80,
  /** Ceiling `overridesSchema` allows for `enrichment.monthlyCreditCap` (Plan 9: the user's paid
   * Apollo plan has 2,500 credits/month; 5,000 leaves headroom without being unbounded). */
  monthlyCreditCapMax: 5000,
  /** How long ApolloEnrichmentProvider.creditUsage() memoizes a successful fetch before refetching. */
  creditUsageTtlMs: 5 * 60_000,
  /**
   * Plan 9 Task 3: a domain with at least this many *decision-maker* hits in Apollo's People
   * Search — not a raw employee headcount — is a national chain, not an SMB. Every People Search
   * call (below) already filters by `preferredTitles`/`seniorities`, so the `total_entries` Apollo
   * returns (searchPeople's `totalAtDomain`, from the unlocated first call, any location) counts
   * only title/seniority-matching people, not the whole company. Deliberately high so a franchise
   * brand stays eligible while a true national head office is excluded before a credit is spent.
   *
   * Fix round (review N1): the doc comment and the runEnrich/isEnrichIssueMessage wording both
   * used to say "people"/"headcount", which read as a raw employee count — corrected everywhere to
   * "decision-makers" to match what Apollo is actually counting here.
   *
   * Measured 2026-09-17 with live zero-credit probes at this title/seniority filter:
   * hrblock.com 4,753 (excluded — well over the threshold), zumiez.com 726 and petparadise.com 89
   * (both below threshold at this granularity — caught instead by the seed chain list, see
   * exclusion.ts), snapfitness.com 850 (franchise-owned — stays eligible either way, consistent
   * with keeping "snap fitness" off the seed list), kidsrkids.com 31 (a real franchise SMB
   * prospect). Changing `preferredTitles`/`seniorities` changes what Apollo counts here too, so
   * this threshold should be re-measured if those change.
   */
  chainHeadcountMin: 1000,
  preferredTitles: ["owner", "founder", "general manager", "office manager", "president", "ceo", "manager"],
  seniorities: ["owner", "founder", "c_suite", "vp", "director", "manager"],
  /** Skip a paid re-enrich (and the provider calls it would cost) within this many days of the last successful run, unless forced. */
  recheckDays: 30,
} as const;
