import type { PageFetcher } from "@/lib/extract/website";
import type { DiscoveredBusiness, DiscoveryProvider, GeocodeProvider, GeocodeResult, ValidationProvider } from "./types";

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export class FakeGeocodeProvider implements GeocodeProvider {
  async geocodeZip(zip: string): Promise<GeocodeResult | null> {
    if (!/^\d{5}$/.test(zip)) return null;
    const n = Number(zip.slice(2));
    return { lat: 29.7 + n / 10_000, lng: -95.5 - n / 10_000, city: "Houston", state: "TX", radiusMeters: 3000 };
  }
}

/** Two SMBs per query plus one chain for coffee-shop queries so exclusion is exercised. */
export class FakeDiscoveryProvider implements DiscoveryProvider {
  async searchCategory(rawQuery: string): Promise<DiscoveredBusiness[]> {
    // The job sends "<category query> in <zip>"; names and ids use the bare category query.
    const query = rawQuery.replace(/\s+in\s+\d{5}$/, "");
    const slug = slugify(query);
    const mk = (i: number, name: string, website: string | null): DiscoveredBusiness => ({
      placeId: `fake-${slug}-${i}`,
      name,
      formattedAddress: `${100 + i} Fake St, Houston, TX 77084, USA`,
      zip: "77084",
      lat: 29.84,
      lng: -95.66,
      phone: `(713) 555-01${String(i).padStart(2, "0")}`,
      websiteUrl: website,
      rating: 4.2,
      reviewCount: 10 + i,
      types: [slug],
    });
    // Every other category gets a dead website on its second business so
    // "unreachable" paths are exercised in tests and demos.
    const deadSite = slug.length % 2 === 0;
    const list = [
      mk(1, `${query} One`, `https://${slug}-one.fake.test/`),
      mk(2, `${query} Two`, deadSite ? `https://dead.${slug}-two.fake.test/` : null),
    ];
    if (slug.startsWith("coffee-shop")) list.push(mk(3, "Starbucks", "https://www.starbucks.com/"));
    return list;
  }
}

export class FakeValidationProvider implements ValidationProvider {
  async checkWebsite(url: string) {
    return url.includes("dead.") ? { reachable: false, error: "timeout" } : { reachable: true };
  }
  async domainHasMx(domain: string) {
    return !domain.includes("nomx");
  }
}

export const fakeFetcher: PageFetcher = async (url) => {
  if (url.includes("dead.")) return { ok: false, error: "timeout" };
  const host = new URL(url).hostname;
  const html = `<html><body>
    <h1>${host}</h1>
    <a href="mailto:info@${host}">Email us</a>
    <a href="tel:+17135550142">Call</a>
    <a href="https://www.facebook.com/${host.split(".")[0]}">Facebook</a>
    <p>Fast internet provided by Spectrum Business.</p>
    <a href="/contact">Contact</a>
  </body></html>`;
  return { ok: true, status: 200, html, finalUrl: url };
};
