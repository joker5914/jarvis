import { withBudget } from "./budget";
import { getProviderKey } from "./keys";
import type { DiscoveredBusiness, DiscoveryProvider, GeocodeProvider, GeocodeResult } from "./types";

type LatLng = { lat: number; lng: number };
type Viewport = { northeast: LatLng; southwest: LatLng };
type GeocodeComponent = { long_name: string; short_name: string; types: string[] };

export type PlacesApiPlace = {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  nationalPhoneNumber?: string;
  websiteUri?: string;
  rating?: number;
  userRatingCount?: number;
  types?: string[];
  addressComponents?: { longText?: string; shortText?: string; types: string[] }[];
};

const SEARCH_FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.nationalPhoneNumber",
  "places.websiteUri",
  "places.rating",
  "places.userRatingCount",
  "places.types",
  "places.addressComponents",
  "nextPageToken",
].join(",");

export const IDS_ONLY_FIELD_MASK = "places.id,nextPageToken";
export const PLACE_DETAILS_FIELD_MASK = [
  "id", "displayName", "formattedAddress", "location", "nationalPhoneNumber", "websiteUri", "rating", "userRatingCount", "types", "addressComponents",
].join(",");

function haversineMeters(a: LatLng, b: LatLng) {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function radiusFromViewport(v: Viewport | undefined): number {
  if (!v) return 3000;
  const half = haversineMeters(v.northeast, v.southwest) / 2;
  return Math.round(Math.max(1500, Math.min(8000, half)));
}

export function cityAndState(components: GeocodeComponent[]) {
  const find = (t: string) => components.find((c) => c.types.includes(t));
  const city = find("locality") ?? find("sublocality") ?? find("neighborhood") ?? find("postal_town");
  const state = find("administrative_area_level_1");
  return { city: city?.long_name ?? null, state: state?.short_name ?? null };
}

export function mapPlace(p: PlacesApiPlace): DiscoveredBusiness {
  const zip = p.addressComponents?.find((c) => c.types.includes("postal_code"))?.longText ?? null;
  return {
    placeId: p.id,
    name: p.displayName?.text ?? "",
    formattedAddress: p.formattedAddress ?? null,
    zip,
    lat: p.location?.latitude ?? null,
    lng: p.location?.longitude ?? null,
    phone: p.nationalPhoneNumber ?? null,
    websiteUrl: p.websiteUri ?? null,
    rating: p.rating ?? null,
    reviewCount: p.userRatingCount ?? null,
    types: p.types ?? [],
  };
}

async function requireKey() {
  const key = await getProviderKey("google");
  if (!key) throw new Error("GOOGLE_MAPS_API_KEY is not configured");
  return key;
}

export class GoogleGeocodeProvider implements GeocodeProvider {
  async geocodeZip(zip: string): Promise<GeocodeResult | null> {
    const key = await requireKey();
    const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    url.searchParams.set("components", `postal_code:${zip}|country:US`);
    url.searchParams.set("key", key);
    const data = await withBudget("google", async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Geocoding HTTP ${res.status}`);
      return res.json() as Promise<{
        status: string;
        results: { geometry: { location: LatLng; bounds?: Viewport; viewport?: Viewport }; address_components: GeocodeComponent[] }[];
      }>;
    });
    if (data.status === "OVER_QUERY_LIMIT" || data.status === "REQUEST_DENIED") {
      throw new Error(`Geocoding ${data.status}`);
    }
    const r = data.results?.[0];
    if (!r) return null;
    const { city, state } = cityAndState(r.address_components);
    return {
      lat: r.geometry.location.lat,
      lng: r.geometry.location.lng,
      city,
      state,
      radiusMeters: radiusFromViewport(r.geometry.bounds ?? r.geometry.viewport),
    };
  }
}

export class GooglePlacesProvider implements DiscoveryProvider {
  async searchCategory(
    query: string,
    center: LatLng,
    radiusMeters: number,
    maxResults = 60,
  ): Promise<DiscoveredBusiness[]> {
    const key = await requireKey();
    const out: DiscoveredBusiness[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < 3 && out.length < maxResults; page++) {
      const body: Record<string, unknown> = {
        textQuery: query,
        pageSize: 20,
        locationBias: {
          circle: { center: { latitude: center.lat, longitude: center.lng }, radius: Math.min(radiusMeters, 50_000) },
        },
      };
      if (pageToken) body.pageToken = pageToken;
      const data = await withBudget("google", async () => {
        const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "X-Goog-Api-Key": key,
            "X-Goog-FieldMask": SEARCH_FIELD_MASK,
          },
          body: JSON.stringify(body),
        });
        if (res.status === 429) throw new Error("Places rate limited (429)");
        if (!res.ok) throw new Error(`Places HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
        return res.json() as Promise<{ places?: PlacesApiPlace[]; nextPageToken?: string }>;
      });
      for (const p of data.places ?? []) out.push(mapPlace(p));
      pageToken = data.nextPageToken;
      if (!pageToken) break;
    }
    return out.slice(0, maxResults);
  }

  async searchCategoryIds(query: string, center: LatLng, radiusMeters: number, maxResults = 60): Promise<string[]> {
    const key = await requireKey();
    const ids: string[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < 3 && ids.length < maxResults; page++) {
      const body: Record<string, unknown> = {
        textQuery: query,
        pageSize: 20,
        locationBias: { circle: { center: { latitude: center.lat, longitude: center.lng }, radius: Math.min(radiusMeters, 50_000) } },
      };
      if (pageToken) body.pageToken = pageToken;
      const data = await withBudget("google", async () => {
        const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
          method: "POST",
          headers: { "content-type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": IDS_ONLY_FIELD_MASK },
          body: JSON.stringify(body),
        });
        if (res.status === 429) throw new Error("Places rate limited (429)");
        if (!res.ok) throw new Error(`Places HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
        return res.json() as Promise<{ places?: { id: string }[]; nextPageToken?: string }>;
      });
      for (const p of data.places ?? []) if (p.id) ids.push(p.id);
      pageToken = data.nextPageToken;
      if (!pageToken) break;
    }
    return ids.slice(0, maxResults);
  }

  async getPlaceDetails(placeId: string): Promise<DiscoveredBusiness | null> {
    const key = await requireKey();
    return withBudget("google", async () => {
      const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
        headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": PLACE_DETAILS_FIELD_MASK },
      });
      if (res.status === 404) return null;
      if (res.status === 429) throw new Error("Places rate limited (429)");
      if (!res.ok) throw new Error(`Place details HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return mapPlace((await res.json()) as PlacesApiPlace);
    });
  }
}
