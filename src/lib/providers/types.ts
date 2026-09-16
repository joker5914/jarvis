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
  searchCategory(
    query: string,
    center: { lat: number; lng: number },
    radiusMeters: number,
    maxResults?: number,
  ): Promise<DiscoveredBusiness[]>;
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

export type Providers = {
  geocode: GeocodeProvider;
  discovery: DiscoveryProvider;
  validation: ValidationProvider;
  registry: ProjectRegistryProvider;
  fetcher: PageFetcher;
};
