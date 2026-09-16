import { describe, it, expect, vi, afterEach } from "vitest";
import { GooglePlacesProvider, IDS_ONLY_FIELD_MASK, PLACE_DETAILS_FIELD_MASK } from "@/lib/providers/google";

vi.mock("@/lib/providers/budget", () => ({ withBudget: async (_p: string, fn: () => Promise<unknown>) => fn() }));
vi.mock("@/lib/providers/keys", () => ({ getProviderKey: async () => "test-key" }));

afterEach(() => vi.unstubAllGlobals());

describe("GooglePlacesProvider ID-only search", () => {
  it("requests only place ids and pages through tokens", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const body = JSON.parse(String(init.body));
      const page = body.pageToken ? 2 : 1;
      return new Response(JSON.stringify({ places: [{ id: `p${page}a` }, { id: `p${page}b` }], nextPageToken: page === 1 ? "tok" : undefined }), { status: 200 });
    }));
    const ids = await new GooglePlacesProvider().searchCategoryIds("nail salon in 77084", { lat: 29.8, lng: -95.6 }, 3000);
    expect(ids).toEqual(["p1a", "p1b", "p2a", "p2b"]);
    expect(calls).toHaveLength(2);
    expect((calls[0].init.headers as Record<string, string>)["X-Goog-FieldMask"]).toBe(IDS_ONLY_FIELD_MASK);
    expect(IDS_ONLY_FIELD_MASK).toBe("places.id,nextPageToken");
  });

  it("fetches place details with the full mask and maps them", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("https://places.googleapis.com/v1/places/p1a");
      expect((init.headers as Record<string, string>)["X-Goog-FieldMask"]).toBe(PLACE_DETAILS_FIELD_MASK);
      return new Response(JSON.stringify({ id: "p1a", displayName: { text: "Bella" }, formattedAddress: "1 Main, Houston, TX 77084", location: { latitude: 1, longitude: 2 }, websiteUri: "https://b.com", types: ["nail_salon"], addressComponents: [{ longText: "77084", types: ["postal_code"] }] }), { status: 200 });
    }));
    const b = await new GooglePlacesProvider().getPlaceDetails("p1a");
    expect(b?.name).toBe("Bella");
    expect(b?.zip).toBe("77084");
    expect(b?.websiteUrl).toBe("https://b.com");
  });

  it("returns null for a 404 place", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
    expect(await new GooglePlacesProvider().getPlaceDetails("gone")).toBeNull();
  });
});
