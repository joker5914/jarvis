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

export interface EnrichmentProvider {
  /**
   * Cheap people lookup by employer domain (fallback: org name + city). Never returns emails.
   * Returns the full ranked candidate page (best match first — see ApolloEnrichmentProvider's
   * titleRank/hasEmail sort), NOT sliced to `max`: the search itself costs no credits, so callers
   * that only want to reveal/pay for `max` of them (runEnrich) do their own `.slice(0, max)` at
   * the point they start spending, while still being able to report how many candidates existed
   * in total. `max` is kept on the signature as a hint a provider MAY use to bound its own
   * request page size, not a hard cap on the result length.
   */
  searchPeople(q: { domain: string | null; orgName: string; city: string | null }, max: number): Promise<EnrichPerson[]>;
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
