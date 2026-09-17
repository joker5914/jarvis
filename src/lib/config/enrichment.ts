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
  /** Plan 9 Task 3: a domain with at least this many people in Apollo (any location — the
   * unlocated first call's total_entries, i.e. searchPeople's totalAtDomain) is a national chain,
   * not an SMB — deliberately high so a franchise brand (kidsrkids.com: 139) stays eligible while
   * a true national head office (hrblock.com: 6,579) is excluded before a credit is spent. */
  chainHeadcountMin: 1000,
  preferredTitles: ["owner", "founder", "general manager", "office manager", "president", "ceo", "manager"],
  seniorities: ["owner", "founder", "c_suite", "vp", "director", "manager"],
  /** Skip a paid re-enrich (and the provider calls it would cost) within this many days of the last successful run, unless forced. */
  recheckDays: 30,
} as const;
