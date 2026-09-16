import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/providers/budget", () => ({ withBudget: async (_p: string, fn: () => Promise<unknown>) => fn() }));
vi.mock("@/lib/providers/keys", () => ({ getProviderKey: async () => "test-key" }));

import { ApolloEnrichmentProvider } from "@/lib/providers/apollo";

type Call = { url: string; init: RequestInit };
let calls: Call[];
function mockFetch(handler: (c: Call) => Response) {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => { const c = { url, init }; calls.push(c); return handler(c); }));
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => vi.useRealTimers());
afterEach(() => vi.unstubAllGlobals());

describe("ApolloEnrichmentProvider.searchPeople", () => {
  it("posts domain, titles, seniorities and per_page with the api key header, and ranks owners first", async () => {
    mockFetch(() => json({ total_entries: 3, people: [
      { id: "p1", first_name: "Sam", last_name_obfuscated: "K.", title: "Barista", has_email: true },
      { id: "p2", first_name: "Maria", last_name_obfuscated: "L.", title: "Owner", has_email: true },
      { id: "p3", first_name: "Lee", last_name_obfuscated: "T.", title: "General Manager", has_email: false },
    ] }));
    const p = new ApolloEnrichmentProvider();
    const people = await p.searchPeople({ domain: "bellanails.com", orgName: "Bella Nails", city: "Houston" }, 5);
    expect(calls[0].url).toBe("https://api.apollo.io/api/v1/mixed_people/api_search");
    expect((calls[0].init.headers as Record<string, string>)["x-api-key"]).toBe("test-key");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.q_organization_domains_list).toEqual(["bellanails.com"]);
    expect(body.per_page).toBe(5);
    expect(body.person_titles).toContain("owner");
    expect(body.person_seniorities).toContain("owner");
    expect(people.map((x) => x.apolloId)).toEqual(["p2", "p3", "p1"]);
    expect(people[0]).toMatchObject({ firstName: "Maria", lastName: null, title: "Owner", email: null, hasEmail: true });
  });
  it("falls back to keyword + location when there is no domain", async () => {
    mockFetch(() => json({ total_entries: 0, people: [] }));
    await new ApolloEnrichmentProvider().searchPeople({ domain: null, orgName: "Bella Nails", city: "Houston" }, 5);
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.q_organization_domains_list).toBeUndefined();
    expect(body.q_keywords).toBe("Bella Nails");
    expect(body.organization_locations).toEqual(["Houston"]);
  });
  it("treats 422 as no results and throws on other errors", async () => {
    mockFetch(() => json({ error: "bad" }, 422));
    expect(await new ApolloEnrichmentProvider().searchPeople({ domain: "x.com", orgName: "X", city: null }, 5)).toEqual([]);
    mockFetch(() => json({ error: "slow down" }, 429));
    await expect(new ApolloEnrichmentProvider().searchPeople({ domain: "x.com", orgName: "X", city: null }, 5)).rejects.toThrow(/429/);
  });
});

describe("ApolloEnrichmentProvider.enrichPerson", () => {
  it("posts people/match with the id and maps email and linkedin", async () => {
    mockFetch(() => json({ person: { id: "p2", first_name: "Maria", last_name: "Lopez", name: "Maria Lopez", title: "Owner", email: "maria@bellanails.com", email_status: "verified", linkedin_url: "https://www.linkedin.com/in/maria-lopez", match_confidence: "high" } }));
    const r = await new ApolloEnrichmentProvider().enrichPerson("p2");
    expect(calls[0].url).toMatch(/^https:\/\/api\.apollo\.io\/api\/v1\/people\/match\?/);
    expect(new URL(calls[0].url).searchParams.get("id")).toBe("p2");
    expect(new URL(calls[0].url).searchParams.get("reveal_personal_emails")).toBe("false");
    expect(r).toMatchObject({ apolloId: "p2", name: "Maria Lopez", email: "maria@bellanails.com", emailStatus: "verified", linkedinUrl: "https://www.linkedin.com/in/maria-lopez" });
  });
  it("returns null when match_confidence is none or person missing", async () => {
    mockFetch(() => json({ person: null }));
    expect(await new ApolloEnrichmentProvider().enrichPerson("nope")).toBeNull();
    mockFetch(() => json({ person: { id: "x", match_confidence: "none" } }));
    expect(await new ApolloEnrichmentProvider().enrichPerson("x")).toBeNull();
  });
});
