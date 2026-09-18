/**
 * Generic USPS state-abbreviation → full-name map (Plan 9 Task 2). Apollo's `person_locations[]`
 * filter takes natural place names ("Pearland, Texas", "Texas, United States"), not the 2-letter
 * codes this app stores everywhere else (see `regionFromAddress` in src/lib/extract/address.ts,
 * re-exported from src/lib/jobs/enrich.ts for its existing callers — moved there in Plan 10 Task 4
 * so a client-side module could use it without pulling in enrich.ts's prisma import), so the
 * location cascade needs a lookup to bridge the two. Deliberately not region-specific — see
 * the Global Constraints note in the Plan 9 doc ("No region literals outside
 * src/lib/config/region.ts; never hard-code Texas or Houston"): this is a plain 50-states-plus-DC
 * table, not an assumption about which state the app operates in.
 */
export const US_STATE_NAMES: Readonly<Record<string, string>> = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  DC: "District of Columbia",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming",
};

/** Case-insensitive lookup; null for anything not a recognized 2-letter USPS code (including null/undefined). */
export function stateNameFor(abbr: string | null | undefined): string | null {
  if (!abbr) return null;
  return US_STATE_NAMES[abbr.toUpperCase()] ?? null;
}
