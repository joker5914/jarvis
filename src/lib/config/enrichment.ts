/** Apollo people enrichment defaults (spec 5.2): at most 5 people per business, decision-makers first. */
export const ENRICH_CONFIG = {
  maxPeople: 5,
  preferredTitles: ["owner", "founder", "general manager", "office manager", "president", "ceo", "manager"],
  seniorities: ["owner", "founder", "c_suite", "vp", "director", "manager"],
} as const;
