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

export type Providers = {
  geocode: GeocodeProvider;
  discovery: DiscoveryProvider;
  validation: ValidationProvider;
  fetcher: PageFetcher;
};
