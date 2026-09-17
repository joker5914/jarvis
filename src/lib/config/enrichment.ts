/**
 * Apollo people enrichment defaults (spec 5.2, Plan 7 credit strategy): one decision-maker
 * revealed per business by default — the free tier is 85 credits/month and each verified
 * net-new email costs one, so a shotgun reveal of up to 5 people per business burns the
 * monthly budget in a handful of runs. `maxPeople` is a default that Settings/the caller can
 * raise up to `maxPeopleLimit`; `monthlyCreditCapDefault` seeds `RuntimeConfig.enrichment`
 * (kept a few credits under the free tier's 85 as headroom) until the user sets their own cap.
 */
export const ENRICH_CONFIG = {
  maxPeople: 1,
  maxPeopleLimit: 5,
  monthlyCreditCap: 85,
  monthlyCreditCapDefault: 80,
  preferredTitles: ["owner", "founder", "general manager", "office manager", "president", "ceo", "manager"],
  seniorities: ["owner", "founder", "c_suite", "vp", "director", "manager"],
  /** Skip a paid re-enrich (and the provider calls it would cost) within this many days of the last successful run, unless forced. */
  recheckDays: 30,
} as const;
