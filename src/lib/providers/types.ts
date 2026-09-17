import type { PageFetcher } from "@/lib/extract/website";

export type GeocodeResult = {
  lat: number;
  lng: number;
  city: string | null;
  state: string | null;
  radiusMeters: number;
};

export interface GeocodeProvider {
  geocodeZip(zip: string): Promise<GeocodeResult | null>;
}

export type DiscoveredBusiness = {
  placeId: string;
  name: string;
  formattedAddress: string | null;
  zip: string | null;
  lat: number | null;
  lng: number | null;
  phone: string | null;
  websiteUrl: string | null;
  rating: number | null;
  reviewCount: number | null;
  types: string[];
};

export interface DiscoveryProvider {
  /** Full results (name, phone, website...). Used by the promote flow for a handful of candidates. */
  searchCategory(
    query: string,
    center: { lat: number; lng: number },
    radiusMeters: number,
    maxResults?: number,
  ): Promise<DiscoveredBusiness[]>;
  /** IDs-only Text Search (free SKU). Used by zip search; details are fetched separately for new IDs. */
  searchCategoryIds(
    query: string,
    center: { lat: number; lng: number },
    radiusMeters: number,
    maxResults?: number,
  ): Promise<string[]>;
  /** Place Details for one place; null when the place no longer exists. */
  getPlaceDetails(placeId: string): Promise<DiscoveredBusiness | null>;
}

export interface ValidationProvider {
  checkWebsite(url: string): Promise<{ reachable: boolean; error?: string }>;
  domainHasMx(domain: string): Promise<boolean>;
}

export type ProjectSummary = {
  tdlrProjectId: string;
  projectNumber: string;
  projectName: string;
  facilityName: string | null;
  registeredAt: Date;
  statusCode: number;
  cityCode: number;
  countyCode: number;
  workTypeCode: number;
  estimatedCost: number | null;
  startDate: Date | null;
  completionDate: Date | null;
};

export type ProjectDetail = {
  projectNumber: string;
  projectName: string | null;
  facilityName: string | null;
  locationAddress: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  county: string | null;
  startDate: Date | null;
  completionDate: Date | null;
  estimatedCost: number | null;
  workTypeLabel: string | null;
  fundsType: string | null;
  scopeOfWork: string | null;
  squareFootage: number | null;
  tenantFunded: boolean | null;
  statusLabel: string | null;
  registrationDate: Date | null;
  contactName: string | null;
  rasName: string | null;
  rasPhone: string | null;
  ownerName: string | null;
  ownerAddress: string | null;
  ownerPhone: string | null;
  tenantName: string | null;
  designFirmName: string | null;
};

export interface ProjectRegistryProvider {
  listProjects(opts: {
    registeredFrom: Date;
    registeredTo: Date;
    start: number;
    length: number;
  }): Promise<{ total: number; items: ProjectSummary[] }>;
  getProjectDetail(projectNumber: string): Promise<ProjectDetail | null>;
}

export type EnrichPerson = {
  apolloId: string;
  firstName: string | null;
  lastName: string | null;
  name: string | null;
  title: string | null;
  email: string | null;
  emailStatus: string | null;
  linkedinUrl: string | null;
  hasEmail: boolean;
  /** The employer name Apollo attached to this search hit (`person.organization.name`), or null
   * when Apollo didn't return one. Lets runEnrich guard against a shared booking/ordering
   * platform's own staff (e.g. "Booksy") coming back for a lead whose website is really just a
   * page hosted on that platform — see orgNameMatches in src/lib/providers/apollo.ts. */
  orgName: string | null;
};

/** Apollo's account-wide lead-credit balance and current billing cycle, from
 * `usage_stats/credit_usage_stats`. */
export type ApolloCreditUsage = {
  limit: number; // lead_credit.limit
  consumed: number; // lead_credit.consumed
  leftOver: number; // lead_credit.left_over
  cycleStart: Date; // current_credit_cycle.start_date
  cycleEnd: Date; // current_credit_cycle.end_date
  fetchedAt: Date;
};

/** Input to `EnrichmentProvider.searchPeople`. `state` is a 2-letter USPS code (or null) — see
 * `src/lib/geo/usStates.ts` for the abbreviation → full-name conversion the Apollo provider needs
 * before it can filter by `person_locations[]`, which takes natural place names. `metro` is the
 * operator-configured `enrichment.metroLocation` Settings value (e.g. "Houston, Texas"), passed
 * through verbatim as a `person_locations[]` value — it is not derived from the lead's own
 * address, unlike `city`/`state`. */
export type PeopleSearchQuery = {
  domain: string | null;
  orgName: string;
  city: string | null;
  state: string | null;
  metro: string | null;
  /** Decision-maker targeting filters (Plan 9: per-owner Settings values). Optional so a
   * standalone caller -- the chain-sweep script, provider unit tests -- can omit them and get the
   * ENRICH_CONFIG defaults; runEnrich always passes the owner's configured lists. `titles` also
   * sets the result ranking order, so it must be the same list that built the query. */
  titles?: string[];
  seniorities?: string[];
};

/** Which location scope a `searchPeople` cascade attempt matched in. "any" means either the
 * unlocated first call already had everyone (a single-location SMB), no city/state/metro was
 * available to filter by, or every narrower scope came back empty. */
export type PeopleSearchScope = "city" | "metro" | "state" | "any";

export type PeopleSearchResult = {
  people: EnrichPerson[];
  /** Apollo's `total_entries` for the scope that matched (or for the unlocated "any" page when
   * every located scope came back empty, or came back empty because 422 never got a total at
   * all) — a free (no-credit) headcount signal, not sliced to `max` or to `people.length`. */
  totalFound: number;
  /** Apollo's `total_entries` for the unlocated ("any") call specifically — the org's *national*
   * headcount, independent of which scope ultimately matched. Carried through unchanged on every
   * result once the unlocated call has run. Null only when no usable total could be determined at
   * all: the org-search fallback found no matching organization (no call ever made), or the
   * unlocated call itself returned a non-200/422 (no total to trust or cascade against). Used by
   * the Task 3 chain-headcount guard — see ENRICH_CONFIG.chainHeadcountMin. */
  totalAtDomain: number | null;
  scope: PeopleSearchScope;
};

export interface EnrichmentProvider {
  /**
   * Cheap people lookup by employer domain (fallback: org name + city). Never returns emails.
   * Always starts with one unlocated call (`scope: "any"`); when that org's whole page fits in a
   * single page (`totalAtDomain <= searchPageSize` — a single-location SMB), returns immediately.
   * Otherwise cascades city → metro → state, stopping at the first scope with a result (see
   * ApolloEnrichmentProvider.searchPeople for the exact rule, including when the city scope is
   * skipped as ambiguous), so a franchise-brand domain surfaces its *local* decision-maker instead
   * of the head office; falls back to the unlocated page when every located scope is empty.
   * Returns the full ranked candidate page for whichever scope matched (best match first — see
   * ApolloEnrichmentProvider's `rank()` helper), NOT sliced to `max`: the search itself costs no
   * credits, so callers that only want to reveal/pay for `max` of them (runEnrich) do their own
   * `.slice(0, max)` at the point they start spending, while still being able to report how many
   * candidates existed in total via `totalFound`/`totalAtDomain`. `max` is kept on the signature
   * as a hint a provider MAY use to bound its own
   * request page size, not a hard cap on the result length.
   */
  searchPeople(q: PeopleSearchQuery, max: number): Promise<PeopleSearchResult>;
  /** Paid reveal for one person (email, LinkedIn). Null when Apollo has no match. */
  enrichPerson(apolloId: string): Promise<EnrichPerson | null>;
  /** Live account balance (0 credits to call). Null when unavailable (no key, non-200, network
   * error). Memoized per process for ENRICH_CONFIG.creditUsageTtlMs. */
  creditUsage(): Promise<ApolloCreditUsage | null>;
}

export type Providers = {
  geocode: GeocodeProvider;
  discovery: DiscoveryProvider;
  validation: ValidationProvider;
  registry: ProjectRegistryProvider;
  fetcher: PageFetcher;
  enrichment: EnrichmentProvider;
};
