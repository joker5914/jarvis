import { REGION } from "@/lib/config/region";
import type { PageFetcher } from "@/lib/extract/website";
import type {
  ApolloCreditUsage,
  DiscoveredBusiness,
  DiscoveryProvider,
  EnrichPerson,
  EnrichmentProvider,
  GeocodeProvider,
  GeocodeResult,
  ProjectDetail,
  ProjectRegistryProvider,
  ProjectSummary,
  ValidationProvider,
} from "./types";

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
  calls = { searchCategory: 0, searchCategoryIds: 0, getPlaceDetails: 0 };
  /** Raw queries passed to searchCategoryIds, in order — lets tests assert which categories were searched. */
  queries: string[] = [];
  /** `maxResults` seen by each searchCategoryIds call, in order — lets tests assert the per-category cap was passed through. */
  maxResultsSeen: number[] = [];
  /** Every place generated so far, keyed by placeId — the fake's cache of "known" places across categories. */
  known = new Map<string, DiscoveredBusiness>();

  private generate(rawQuery: string): DiscoveredBusiness[] {
    // Promote flow: a query beginning with a fake project's facility name returns one exact match.
    if (/^bella nails & spa\b/i.test(rawQuery)) {
      return [{
        placeId: "fake-bella-nails",
        name: "Bella Nails & Spa",
        formattedAddress: "123 Fake St, Houston, TX 77084, USA",
        zip: "77084",
        lat: 29.84,
        lng: -95.66,
        phone: "(713) 555-0142",
        websiteUrl: "https://bella-nails.fake.test/",
        rating: 4.8,
        reviewCount: 41,
        types: ["nail_salon"],
      }];
    }
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

  async searchCategory(rawQuery: string): Promise<DiscoveredBusiness[]> {
    this.calls.searchCategory++;
    return this.generate(rawQuery);
  }

  async searchCategoryIds(rawQuery: string, _center?: { lat: number; lng: number }, _radiusMeters?: number, maxResults = 60): Promise<string[]> {
    this.calls.searchCategoryIds++;
    this.queries.push(rawQuery);
    this.maxResultsSeen.push(maxResults);
    const list = this.generate(rawQuery);
    for (const biz of list) this.known.set(biz.placeId, biz);
    return list.map((b) => b.placeId);
  }

  async getPlaceDetails(placeId: string): Promise<DiscoveredBusiness | null> {
    this.calls.getPlaceDetails++;
    const cached = this.known.get(placeId);
    if (cached) return cached;
    // Real Google Place IDs are globally stable, so Place Details for an ID this provider
    // instance never generated itself (e.g. a resumed search reusing IDs a Search row
    // persisted from an earlier searchCategoryIds call, possibly on a different provider
    // instance) must still resolve — reconstruct it deterministically from the ID the same
    // way `generate()` would have produced it originally.
    const query = placeId === "fake-bella-nails" ? "bella nails & spa" : /^fake-(.+)-\d+$/.exec(placeId)?.[1]?.replace(/-/g, " ");
    if (!query) return null;
    for (const biz of this.generate(query)) this.known.set(biz.placeId, biz);
    return this.known.get(placeId) ?? null;
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

export class FakeEnrichmentProvider implements EnrichmentProvider {
  calls = { search: 0, enrich: 0, orgSearch: 0 };
  /** Tests set this to simulate a live Apollo balance; defaults to null (unavailable), matching
   * fake mode's "no live Apollo account" stance — see creditUsage() below. */
  fakeCreditUsage: ApolloCreditUsage | null = null;
  // `max` unused (see EnrichmentProvider.searchPeople's doc comment): the fake mirrors Apollo's
  // real behavior of returning the full ranked page and leaving the `max` slice to the caller.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept for EnrichmentProvider API stability
  async searchPeople(q: { domain: string | null; orgName: string; city: string | null }, max: number): Promise<EnrichPerson[]> {
    this.calls.search++;
    const domain = q.domain ?? `${q.orgName.toLowerCase().replace(/[^a-z0-9]+/g, "")}.example`;
    // Defaults to the queried org name (i.e. the real business's own name in the normal runEnrich
    // flow), so orgNameMatches always accepts these by default — tests that want to exercise the
    // targeting guard (Task 4) override searchPeople directly with a mismatched orgName, the same
    // way other tests already override it to simulate provider errors.
    return [
      { apolloId: `fake-${domain}-owner`, firstName: "Maria", lastName: null, name: "Maria", title: "Owner", email: null, emailStatus: null, linkedinUrl: null, hasEmail: true, orgName: q.orgName },
      { apolloId: `fake-${domain}-gm`, firstName: "Lee", lastName: null, name: "Lee", title: "General Manager", email: null, emailStatus: null, linkedinUrl: null, hasEmail: false, orgName: q.orgName },
    ];
  }
  async enrichPerson(apolloId: string): Promise<EnrichPerson | null> {
    this.calls.enrich++;
    const m = apolloId.match(/^fake-(.+)-(owner|gm)$/);
    if (!m) return null;
    const [, domain, role] = m;
    if (role === "gm") return { apolloId, firstName: "Lee", lastName: "Tran", name: "Lee Tran", title: "General Manager", email: null, emailStatus: null, linkedinUrl: "https://www.linkedin.com/in/lee-tran-fake", hasEmail: false, orgName: null };
    return { apolloId, firstName: "Maria", lastName: "Lopez", name: "Maria Lopez", title: "Owner", email: `owner@${domain}`, emailStatus: "verified", linkedinUrl: "https://www.linkedin.com/in/maria-lopez-fake", hasEmail: true, orgName: null };
  }
  async creditUsage(): Promise<ApolloCreditUsage | null> {
    return this.fakeCreditUsage ?? null;
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

const DAY = 24 * 60 * 60 * 1000;
const daysFromNow = (n: number) => new Date(Date.now() + n * DAY);

type FakeProject = ProjectSummary & { detail: ProjectDetail };

function fakeProject(
  n: number,
  p: Partial<ProjectSummary> & Partial<ProjectDetail> & { projectName: string },
): FakeProject {
  const projectNumber = `TABS2027${String(n).padStart(6, "0")}`;
  const summary: ProjectSummary = {
    tdlrProjectId: `fake-project-${n}`,
    projectNumber,
    projectName: p.projectName,
    facilityName: p.facilityName ?? null,
    registeredAt: p.registeredAt ?? daysFromNow(-5),
    statusCode: p.statusCode ?? 3008,
    cityCode: REGION.tdlrCityCode,
    countyCode: 2101,
    workTypeCode: p.workTypeCode ?? 9002,
    estimatedCost: p.estimatedCost ?? null,
    startDate: p.startDate ?? null,
    completionDate: p.completionDate ?? null,
  };
  const detail: ProjectDetail = {
    projectNumber,
    projectName: p.projectName,
    facilityName: p.facilityName ?? null,
    locationAddress: p.locationAddress ?? "123 Fake St",
    city: "Houston",
    state: "TX",
    zip: p.zip ?? "77084",
    county: "Harris",
    startDate: summary.startDate,
    completionDate: summary.completionDate,
    estimatedCost: summary.estimatedCost,
    workTypeLabel: summary.workTypeCode === 9001 ? "New Construction" : "Renovation/Alteration",
    fundsType: "This project is privately funded, on private land for private use.",
    scopeOfWork: p.scopeOfWork ?? "Interior finish-out",
    squareFootage: p.squareFootage ?? null,
    tenantFunded: p.tenantFunded ?? null,
    statusLabel: "Project Registered",
    registrationDate: summary.registeredAt,
    contactName: p.contactName ?? null,
    rasName: "FAKE RAS",
    rasPhone: "(281) 555-0100",
    ownerName: p.ownerName ?? null,
    ownerAddress: null,
    ownerPhone: p.ownerPhone ?? null,
    tenantName: null,
    designFirmName: null,
  };
  return { ...summary, detail };
}

export const FAKE_PROJECTS: FakeProject[] = [
  fakeProject(1, {
    projectName: "Bella Nails Buildout",
    facilityName: "Bella Nails & Spa",
    estimatedCost: 120_000,
    squareFootage: 1_800,
    tenantFunded: true,
    startDate: daysFromNow(-30),
    completionDate: daysFromNow(30),
    ownerName: "Ana Ruiz",
    contactName: "Ana Ruiz",
    ownerPhone: "(713) 555-0142",
  }),
  fakeProject(2, {
    projectName: "Corner Cafe Renovation",
    facilityName: "Corner Cafe",
    estimatedCost: 90_000,
    squareFootage: 1_200,
    tenantFunded: true,
    startDate: daysFromNow(10),
    completionDate: daysFromNow(120),
    ownerName: "Sam Lee",
    ownerPhone: "(713) 555-0177",
  }),
  fakeProject(3, {
    projectName: "Memorial Hermann Tower Dialysis",
    facilityName: "Memorial Hermann",
    estimatedCost: 5_000_000,
    workTypeCode: 9001,
    startDate: daysFromNow(-10),
    completionDate: daysFromNow(200),
  }),
  fakeProject(4, {
    projectName: "Old Coffee Shop Remodel",
    facilityName: "Old Coffee",
    estimatedCost: 50_000,
    startDate: daysFromNow(-300),
    completionDate: daysFromNow(-120),
  }),
];

/** Deterministic registry: four projects registered 5 days ago (one long completed). */
export class FakeRegistryProvider implements ProjectRegistryProvider {
  constructor(private projects: FakeProject[] = FAKE_PROJECTS) {}

  async listProjects(opts: { registeredFrom: Date; registeredTo: Date; start: number; length: number }) {
    const inWindow = this.projects.filter((p) => p.registeredAt >= opts.registeredFrom && p.registeredAt <= opts.registeredTo);
    return {
      total: inWindow.length,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- strip `detail`, keep the ProjectSummary fields
      items: inWindow.slice(opts.start, opts.start + opts.length).map(({ detail: _d, ...s }) => s),
    };
  }

  async getProjectDetail(projectNumber: string): Promise<ProjectDetail | null> {
    return this.projects.find((p) => p.projectNumber === projectNumber)?.detail ?? null;
  }
}
