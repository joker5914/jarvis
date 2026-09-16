/** Apollo people enrichment defaults (spec 5.2): at most 5 people per business, decision-makers first. */
export const ENRICH_CONFIG = {
  maxPeople: 5,
  preferredTitles: ["owner", "founder", "general manager", "office manager", "president", "ceo", "manager"],
  seniorities: ["owner", "founder", "c_suite", "vp", "director", "manager"],
  /** Skip a paid re-enrich (and the provider calls it would cost) within this many days of the last successful run, unless forced. */
  recheckDays: 30,
} as const;
