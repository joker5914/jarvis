import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/providers/budget", () => ({ withBudget: async (_p: string, fn: () => Promise<unknown>) => fn() }));
vi.mock("@/lib/providers/keys", () => ({ getProviderKey: vi.fn(async () => "test-key") }));
// apollo.ts persists a plan block to ProviderConfig (see markPlanBlocked/apolloPlanBlocked) so
// the web process — which never calls Apollo directly — can see a block the worker discovered.
// This unit suite only exercises the in-process memo, so Prisma is mocked out entirely; the real
// persistence path is covered by the DB tests in tests/db/businessEnrichRoute.test.ts. The mock
// factory is hoisted above any top-level const, so its innards must be literal (no closed-over
// variable) — the handle used by tests below comes from importing the (now-mocked) "@/lib/db".
vi.mock("@/lib/db", () => ({
  prisma: {
    providerConfig: {
      upsert: vi.fn(async (_args: unknown) => ({})),
      findUnique: vi.fn(async (_args: unknown) => null as { planBlockedUntil: Date | null; planBlockDetail: string | null } | null),
      updateMany: vi.fn(async (_args: unknown) => ({ count: 0 })),
    },
  },
}));

import { prisma } from "@/lib/db";
import { getProviderKey } from "@/lib/providers/keys";
import {
  ApolloEnrichmentProvider,
  apolloPlanBlocked,
  clearPlanBlock,
  __setPlanBlockedForTests,
  __resetPlanBlockedForTests,
  __resetCreditUsageForTests,
  PEOPLE_SEARCH_PATH,
} from "@/lib/providers/apollo";
import { ProviderPlanError } from "@/lib/providers/errors";
import { ENRICH_CONFIG } from "@/lib/config/enrichment";

const providerConfigMock = prisma.providerConfig as unknown as {
  upsert: ReturnType<typeof vi.fn>;
  findUnique: ReturnType<typeof vi.fn>;
  updateMany: ReturnType<typeof vi.fn>;
};

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
  // Plan 9: the title/seniority filters became per-owner Settings values. The provider takes them
  // off the query so it stays usable standalone (chain-sweep, tests) and falls back to the
  // ENRICH_CONFIG defaults when the caller doesn't supply them.
  it("sends the caller's titles and seniorities, and ranks by the caller's title order", async () => {
    mockFetch(() => json({ total_entries: 2, people: [
      { id: "p1", first_name: "Sam", last_name_obfuscated: "K.", title: "Principal", has_email: false },
      { id: "p2", first_name: "Maria", last_name_obfuscated: "L.", title: "Owner", has_email: false },
    ] }));
    const { people } = await new ApolloEnrichmentProvider().searchPeople(
      { domain: "x.com", orgName: "X", city: null, state: null, metro: null, titles: ["principal", "owner"], seniorities: ["partner"] },
      5,
    );
    const u = new URL(calls[0].url);
    expect(u.searchParams.getAll("person_titles[]")).toEqual(["principal", "owner"]);
    expect(u.searchParams.getAll("person_seniorities[]")).toEqual(["partner"]);
    // "principal" is first in the caller's list, so it outranks the owner -- proving the ranking
    // reads the same list as the query, not the ENRICH_CONFIG default (where owner is first).
    expect(people.map((x) => x.title)).toEqual(["Principal", "Owner"]);
  });

  it("falls back to the ENRICH_CONFIG targeting filters when the query omits them", async () => {
    mockFetch(() => json({ total_entries: 1, people: [{ id: "p1", first_name: "Maria", last_name_obfuscated: "L.", title: "Owner", has_email: false }] }));
    await new ApolloEnrichmentProvider().searchPeople({ domain: "x.com", orgName: "X", city: null, state: null, metro: null }, 5);
    const u = new URL(calls[0].url);
    expect(u.searchParams.getAll("person_titles[]")).toEqual([...ENRICH_CONFIG.preferredTitles]);
    expect(u.searchParams.getAll("person_seniorities[]")).toEqual([...ENRICH_CONFIG.seniorities]);
  });

  it("sends people search parameters in the query string (arrays as name[]), and ranks owners first", async () => {
    mockFetch(() => json({ total_entries: 3, people: [
      { id: "p1", first_name: "Sam", last_name_obfuscated: "K.", title: "Barista", has_email: true },
      { id: "p2", first_name: "Maria", last_name_obfuscated: "L.", title: "Owner", has_email: true },
      { id: "p3", first_name: "Lee", last_name_obfuscated: "T.", title: "General Manager", has_email: false },
    ] }));
    // total_entries (3) <= searchPageSize (10): a single-location SMB, so the unlocated first
    // call already has everyone and returns immediately — no cascade.
    const result = await new ApolloEnrichmentProvider().searchPeople({ domain: "bellanails.com", orgName: "Bella Nails", city: "Houston", state: null, metro: null }, 5);
    expect(calls).toHaveLength(1);
    const u = new URL(calls[0].url);
    expect(u.origin + u.pathname).toBe("https://api.apollo.io/api/v1/mixed_people/api_search");
    expect(u.searchParams.getAll("q_organization_domains_list[]")).toEqual(["bellanails.com"]);
    expect(u.searchParams.getAll("person_titles[]")).toContain("owner");
    expect(u.searchParams.getAll("person_seniorities[]")).toContain("owner");
    expect(u.searchParams.get("include_similar_titles")).toBe("true");
    expect(u.searchParams.has("person_locations[]")).toBe(false);
    // People Search is free of credits: always requests a full page (searchPageSize), regardless
    // of `max`, then ranks and slices locally (see Plan 8 Task 7).
    expect(u.searchParams.get("per_page")).toBe("10");
    expect(u.searchParams.get("page")).toBe("1");
    expect(calls[0].init.body).toBeUndefined();
    expect((calls[0].init.headers as Record<string, string>)["x-api-key"]).toBe("test-key");
    expect(result.scope).toBe("any");
    expect(result.totalAtDomain).toBe(3);
    expect(result.people.map((x) => x.apolloId)).toEqual(["p2", "p3", "p1"]);
    expect(result.people[0]).toMatchObject({ firstName: "Maria", lastName: null, title: "Owner", email: null, hasEmail: true });
  });

  it("without a domain, organization has a primary_domain: org search by name + city, then people by q_organization_domains_list[]", async () => {
    mockFetch((c) => c.url.includes("/mixed_companies/search")
      ? json({ organizations: [{ id: "org1", name: "Bella Nails", primary_domain: "bellanails.com" }] })
      : json({ total_entries: 1, people: [{ id: "p1", first_name: "Maria", title: "Owner", has_email: true }] }));
    const result = await new ApolloEnrichmentProvider().searchPeople({ domain: null, orgName: "Bella Nails", city: "Houston", state: null, metro: null }, 5);
    const org = new URL(calls[0].url);
    expect(org.pathname).toBe("/api/v1/mixed_companies/search");
    expect(org.searchParams.get("q_organization_name")).toBe("Bella Nails");
    expect(org.searchParams.getAll("organization_locations[]")).toEqual(["Houston"]);
    expect(org.searchParams.get("per_page")).toBe("1");
    expect(org.searchParams.get("page")).toBe("1");
    const ppl = new URL(calls[1].url);
    expect(ppl.searchParams.getAll("q_organization_domains_list[]")).toEqual(["bellanails.com"]);
    expect(ppl.searchParams.has("organization_ids[]")).toBe(false);
    expect(result.people.map((p) => p.apolloId)).toEqual(["p1"]);
    // Reviewer nit: the org-fallback branch runs the same unlocated-first cascade as the
    // domain branch, so it carries scope/totalAtDomain too.
    expect(result.scope).toBe("any");
    expect(result.totalAtDomain).toBe(1);
  });

  it("without a domain, organization has no primary_domain: people search falls back to organization_ids[]", async () => {
    mockFetch((c) => c.url.includes("/mixed_companies/search")
      ? json({ organizations: [{ id: "org1", name: "Bella Nails" }] })
      : json({ total_entries: 1, people: [{ id: "p1", first_name: "Maria", title: "Owner", has_email: true }] }));
    const result = await new ApolloEnrichmentProvider().searchPeople({ domain: null, orgName: "Bella Nails", city: "Houston", state: null, metro: null }, 5);
    const ppl = new URL(calls[1].url);
    expect(ppl.searchParams.getAll("organization_ids[]")).toEqual(["org1"]);
    expect(ppl.searchParams.has("q_organization_domains_list[]")).toBe(false);
    expect(result.people.map((p) => p.apolloId)).toEqual(["p1"]);
    expect(result.scope).toBe("any");
    expect(result.totalAtDomain).toBe(1);
  });

  it("without a domain and no organization match: returns an empty result with totalAtDomain null (no search ever ran) after one org-search call", async () => {
    mockFetch(() => json({ organizations: [] }));
    const result = await new ApolloEnrichmentProvider().searchPeople({ domain: null, orgName: "Nope", city: null, state: null, metro: null }, 5);
    expect(result).toEqual({ people: [], totalFound: 0, totalAtDomain: null, scope: "any" });
    expect(calls).toHaveLength(1);
  });

  it("a 422 on the unlocated first call returns totalAtDomain null (no total to trust) and does not cascade; other HTTP errors still throw", async () => {
    mockFetch(() => json({ error: "bad" }, 422));
    const result = await new ApolloEnrichmentProvider().searchPeople({ domain: "x.com", orgName: "X", city: "Pearland", state: "TX", metro: "Houston, Texas" }, 5);
    expect(result).toEqual({ people: [], totalFound: 0, totalAtDomain: null, scope: "any" });
    expect(calls).toHaveLength(1); // no cascade attempted — a 422 total isn't one to compare against searchPageSize
    mockFetch(() => json({ error: "slow down" }, 429));
    await expect(new ApolloEnrichmentProvider().searchPeople({ domain: "x.com", orgName: "X", city: null, state: null, metro: null }, 5)).rejects.toThrow(/429/);
  });

  // Live bug (Plan 8 Task 7): searchPeople used to request per_page: max (often 1) AND slice its
  // own result to max, so Apollo's own row ordering decided who was ever seen — the best
  // candidate could be sitting further down the page and never come back at all. Fetching a full
  // page (searchPageSize) and returning the whole ranked list (not sliced to `max`) means the
  // caller (runEnrich) sees every candidate Apollo found and decides for itself how many to spend
  // paid reveals on — `max` no longer bounds what searchPeople itself returns.
  it("requests a full page (searchPageSize) even when max is small, and returns the whole list ranked with the best candidate first", async () => {
    mockFetch(() => json({ total_entries: 5, people: [
      { id: "p1", first_name: "Sam", title: "Barista", has_email: false },
      { id: "p2", first_name: "Alex", title: "Barista", has_email: false },
      { id: "p3", first_name: "Jordan", title: "Production/Operations Manager", has_email: true },
      { id: "p4", first_name: "Casey", title: "Store Manager", has_email: false },
      { id: "p5", first_name: "Riley", title: "Owner", has_email: false },
    ] }));
    const { people } = await new ApolloEnrichmentProvider().searchPeople({ domain: "x.com", orgName: "X", city: null, state: null, metro: null }, 1);
    const u = new URL(calls[0].url);
    expect(u.searchParams.get("per_page")).toBe("10"); // requests the full page, not max=1
    expect(people).toHaveLength(5); // not sliced to max=1 — the caller decides how many to act on
    expect(people[0]).toMatchObject({ apolloId: "p5", title: "Owner" }); // title rank wins outright
  });

  it("ranks by titleRank asc, then hasEmail desc, so a tied-rank title with an email beats one without", async () => {
    mockFetch(() => json({ total_entries: 2, people: [
      { id: "p4", first_name: "Casey", title: "Store Manager", has_email: false },
      { id: "p3", first_name: "Jordan", title: "Production/Operations Manager", has_email: true },
    ] }));
    const { people } = await new ApolloEnrichmentProvider().searchPeople({ domain: "x.com", orgName: "X", city: null, state: null, metro: null }, 5);
    expect(people.map((p) => p.apolloId)).toEqual(["p3", "p4"]); // same title rank (both "manager"), email breaks the tie
  });

  it("maps organization.name to orgName, and null when organization (or its name) is absent", async () => {
    mockFetch(() => json({ total_entries: 2, people: [
      { id: "p1", first_name: "Sam", title: "Owner", has_email: true, organization: { name: "Booksy" } },
      { id: "p2", first_name: "Lee", title: "Manager", has_email: true, organization: {} },
    ] }));
    const { people } = await new ApolloEnrichmentProvider().searchPeople({ domain: "x.com", orgName: "X", city: null, state: null, metro: null }, 5);
    const byId = Object.fromEntries(people.map((p) => [p.apolloId, p]));
    expect(byId.p1.orgName).toBe("Booksy");
    expect(byId.p2.orgName).toBeNull();
  });

  describe("location cascade (unlocated first, then city → metro → state)", () => {
    it("small org: total_entries within the page size on the unlocated call — exactly 1 fetch, scope 'any', totalAtDomain matches", async () => {
      mockFetch(() => json({ total_entries: 3, people: [
        { id: "p1", first_name: "Ana", title: "Owner", has_email: true },
      ] }));
      const result = await new ApolloEnrichmentProvider().searchPeople({ domain: "bellanails.com", orgName: "Bella Nails", city: "Pearland", state: "TX", metro: "Houston, Texas" }, 1);
      expect(calls).toHaveLength(1);
      expect(new URL(calls[0].url).searchParams.has("person_locations[]")).toBe(false);
      expect(result).toMatchObject({ scope: "any", totalFound: 3, totalAtDomain: 3 });
    });

    it("large org: unlocated (139) → city (0) → metro (20, non-empty) — 3 fetches, scope 'metro', totalFound from the metro call, totalAtDomain from the unlocated call", async () => {
      let call = 0;
      mockFetch(() => {
        call++;
        if (call === 1) return json({ total_entries: 139, people: [{ id: "p0", first_name: "Nat", title: "CEO", has_email: true }] });
        if (call === 2) return json({ total_entries: 0, people: [] });
        return json({ total_entries: 20, people: [{ id: "p1", first_name: "Jamie", title: "Preschool Director", has_email: true }] });
      });
      const result = await new ApolloEnrichmentProvider().searchPeople({ domain: "kidsrkids.com", orgName: "Kids R Kids", city: "Pearland", state: "TX", metro: "Houston, Texas" }, 1);
      expect(calls).toHaveLength(3);
      expect(new URL(calls[0].url).searchParams.has("person_locations[]")).toBe(false);
      expect(new URL(calls[1].url).searchParams.getAll("person_locations[]")).toEqual(["Pearland, Texas"]);
      expect(new URL(calls[2].url).searchParams.getAll("person_locations[]")).toEqual(["Houston, Texas"]); // metro string passed verbatim
      expect(result.scope).toBe("metro");
      expect(result.totalFound).toBe(20);
      expect(result.totalAtDomain).toBe(139);
      expect(result.people.map((p) => p.apolloId)).toEqual(["p1"]);
    });

    it("large org, every located scope empty: falls back to the unlocated page, scope 'any', 4 fetches (any + city + metro + state)", async () => {
      let call = 0;
      mockFetch(() => {
        call++;
        if (call === 1) return json({ total_entries: 139, people: [{ id: "p0", first_name: "Nat", title: "CEO", has_email: true }] });
        return json({ total_entries: 0, people: [] });
      });
      const result = await new ApolloEnrichmentProvider().searchPeople({ domain: "hrblock.com", orgName: "H&R Block", city: "Pearland", state: "TX", metro: "Houston, Texas" }, 1);
      expect(calls).toHaveLength(4);
      expect(new URL(calls[1].url).searchParams.getAll("person_locations[]")).toEqual(["Pearland, Texas"]);
      expect(new URL(calls[2].url).searchParams.getAll("person_locations[]")).toEqual(["Houston, Texas"]);
      expect(new URL(calls[3].url).searchParams.getAll("person_locations[]")).toEqual(["Texas, United States"]);
      expect(result.scope).toBe("any");
      expect(result.totalFound).toBe(139); // the unlocated page's own total, since that's what's returned
      expect(result.totalAtDomain).toBe(139);
      expect(result.people.map((p) => p.apolloId)).toEqual(["p0"]); // the unlocated page's own (already-fetched) people
    });

    it("no metro configured: the metro call is skipped — at most 3 fetches (any + city + state)", async () => {
      let call = 0;
      mockFetch(() => {
        call++;
        if (call === 1) return json({ total_entries: 139, people: [{ id: "p0", first_name: "Nat", title: "CEO", has_email: true }] });
        if (call === 2) return json({ total_entries: 0, people: [] });
        return json({ total_entries: 5, people: [{ id: "p1", first_name: "Sam", title: "Manager", has_email: true }] });
      });
      const result = await new ApolloEnrichmentProvider().searchPeople({ domain: "hrblock.com", orgName: "H&R Block", city: "Pearland", state: "TX", metro: null }, 1);
      expect(calls).toHaveLength(3);
      expect(new URL(calls[1].url).searchParams.getAll("person_locations[]")).toEqual(["Pearland, Texas"]);
      expect(new URL(calls[2].url).searchParams.getAll("person_locations[]")).toEqual(["Texas, United States"]);
      expect(result.scope).toBe("state");
    });

    it("metro equal to the lead's own city is not queried twice — at most 3 fetches (any + city + state)", async () => {
      let call = 0;
      mockFetch(() => {
        call++;
        if (call === 1) return json({ total_entries: 139, people: [{ id: "p0", first_name: "Nat", title: "CEO", has_email: true }] });
        if (call === 2) return json({ total_entries: 0, people: [] });
        return json({ total_entries: 5, people: [{ id: "p1", first_name: "Sam", title: "Manager", has_email: true }] });
      });
      const result = await new ApolloEnrichmentProvider().searchPeople({ domain: "hrblock.com", orgName: "H&R Block", city: "Houston", state: "TX", metro: "houston, texas" }, 1);
      expect(calls).toHaveLength(3);
      expect(new URL(calls[1].url).searchParams.getAll("person_locations[]")).toEqual(["Houston, Texas"]);
      expect(new URL(calls[2].url).searchParams.getAll("person_locations[]")).toEqual(["Texas, United States"]);
      expect(result.scope).toBe("state");
    });

    it("large org, no city/state/metro available at all: falls back to the unlocated page after 1 fetch, scope 'any'", async () => {
      mockFetch(() => json({ total_entries: 6579, people: [
        { id: "p1", first_name: "Alex", title: "Assistant Manager", has_email: true },
      ] }));
      const result = await new ApolloEnrichmentProvider().searchPeople({ domain: "hrblock.com", orgName: "H&R Block", city: null, state: null, metro: null }, 1);
      expect(calls).toHaveLength(1);
      expect(new URL(calls[0].url).searchParams.has("person_locations[]")).toBe(false);
      expect(result.scope).toBe("any");
      expect(result.totalFound).toBe(6579);
      expect(result.totalAtDomain).toBe(6579);
    });

    it("large org, city present but state unknown (null): the city scope is skipped as ambiguous, no metro/state either — falls back to 'any' after 1 fetch", async () => {
      mockFetch(() => json({ total_entries: 50, people: [{ id: "p1", first_name: "Sam", title: "Owner", has_email: true }] }));
      const result = await new ApolloEnrichmentProvider().searchPeople({ domain: "x.com", orgName: "X", city: "Somewhere", state: null, metro: null }, 1);
      expect(calls).toHaveLength(1);
      expect(new URL(calls[0].url).searchParams.has("person_locations[]")).toBe(false);
      expect(result.scope).toBe("any");
    });
  });
});

describe("ApolloEnrichmentProvider.searchOrganization", () => {
  it("422 on organization search returns null", async () => {
    mockFetch(() => json({ error: "bad" }, 422));
    expect(await new ApolloEnrichmentProvider().searchOrganization("Nope", null)).toBeNull();
  });

  it("accepts when normalized names match after folding '&' and 'and' to the same token", async () => {
    mockFetch(() => json({ organizations: [{ id: "org1", name: "Bella Nails and Spa", primary_domain: "bellanails.com" }] }));
    const org = await new ApolloEnrichmentProvider().searchOrganization("Bella Nails & Spa", null);
    expect(org).toEqual({ id: "org1", primaryDomain: "bellanails.com" });
  });

  it("rejects a single-word request that is merely a substring of a differently-named org, with no follow-up call", async () => {
    mockFetch(() => json({ organizations: [{ id: "org1", name: "Joe's Crab Shack", primary_domain: "joescrabshack.com" }] }));
    const result = await new ApolloEnrichmentProvider().searchPeople({ domain: null, orgName: "Joe's", city: null, state: null, metro: null }, 5);
    expect(result).toEqual({ people: [], totalFound: 0, totalAtDomain: null, scope: "any" });
    expect(calls).toHaveLength(1);
  });

  it("accepts a shorter request (>= 2 words) contained in a longer org name", async () => {
    mockFetch(() => json({ organizations: [{ id: "org1", name: "Bella Nails Katy", primary_domain: "bellanailskaty.com" }] }));
    const org = await new ApolloEnrichmentProvider().searchOrganization("Bella Nails", null);
    expect(org).toEqual({ id: "org1", primaryDomain: "bellanailskaty.com" });
  });

  it("rejects an unrelated org name", async () => {
    mockFetch(() => json({ organizations: [{ id: "org1", name: "Katy Dental", primary_domain: "katydental.com" }] }));
    expect(await new ApolloEnrichmentProvider().searchOrganization("Bella Nails", null)).toBeNull();
  });
});

describe("ApolloEnrichmentProvider Free-plan 403 (API_INACCESSIBLE)", () => {
  beforeEach(() => {
    providerConfigMock.upsert.mockClear();
    providerConfigMock.findUnique.mockClear();
    // Default: simulate a persisted row that agrees with whatever this process's own memo says
    // (i.e. "still blocked, far in the future"). checkPlanBlocked() only ever reads this when the
    // memo itself already says blocked (see its "zero extra reads on the unblocked path"
    // contract), so most tests below never hit this at all; the ones that do (e.g. a second call
    // within the TTL window) expect the row to still agree with the memo, matching what a real
    // markPlanBlocked() would have persisted. Tests exercising the D1 "row was cleared out from
    // under the memo" path override this per-call with mockResolvedValueOnce/mockRejectedValueOnce.
    providerConfigMock.findUnique.mockImplementation(async () => ({
      planBlockedUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
      planBlockDetail: "API_INACCESSIBLE",
    }));
  });
  afterEach(() => __resetPlanBlockedForTests());

  it("a 403 with error_code API_INACCESSIBLE throws ProviderPlanError, persists the block, and memoizes so the next call skips fetch entirely", async () => {
    mockFetch(() =>
      json(
        {
          error:
            "The api/v1/mixed_people/api_search API is not included in your Free plan and is not accessible, even with a master key. All paid plans include full API access. Upgrade your plan from https://www.apollo.io/pricing",
          error_code: "API_INACCESSIBLE",
        },
        403,
      ),
    );
    const provider = new ApolloEnrichmentProvider();
    await expect(provider.searchPeople({ domain: "x.com", orgName: "X", city: null, state: null, metro: null }, 5)).rejects.toBeInstanceOf(ProviderPlanError);
    expect(calls).toHaveLength(1);
    // Persisted (via markPlanBlocked's upsert) so the Next.js web process, which never sees this
    // in-memory memo, can still learn about the block by reading ProviderConfig.
    expect(providerConfigMock.upsert).toHaveBeenCalledTimes(1);
    expect(providerConfigMock.upsert.mock.calls[0][0]).toMatchObject({
      where: { provider: "apollo" },
      update: { planBlockDetail: "API_INACCESSIBLE" },
    });

    // Second call, same process: the memo should short-circuit before any network call.
    await expect(provider.searchPeople({ domain: "x.com", orgName: "X", city: null, state: null, metro: null }, 5)).rejects.toBeInstanceOf(ProviderPlanError);
    expect(calls).toHaveLength(1); // fetch mock still only called once total
    expect(providerConfigMock.upsert).toHaveBeenCalledTimes(1); // no new persistence on the memo hit
  });

  it("falls back to matching the error text (/not included in your/i) when error_code is absent, defaulting detail to API_INACCESSIBLE", async () => {
    mockFetch(() =>
      json({ error: "This endpoint is not included in your Basic (Trial) plan and is not accessible, even with a master key." }, 403),
    );
    await expect(new ApolloEnrichmentProvider().searchPeople({ domain: "x.com", orgName: "X", city: null, state: null, metro: null }, 5)).rejects.toBeInstanceOf(
      ProviderPlanError,
    );
    expect(providerConfigMock.upsert.mock.calls[0][0]).toMatchObject({ update: { planBlockDetail: "API_INACCESSIBLE" } });
  });

  // H2: a live 403 body observed on some accounts carries BOTH error_code and a nested
  // error_details object; classification must catch it via either signal.
  it("classifies a live 403 body (error_code AND error_details.code/message) as a plan block", async () => {
    mockFetch(() =>
      json(
        {
          error:
            "The api/v1/mixed_people/api_search API is not included in your Basic (Trial) plan and is not accessible, even with a master key. All paid plans include full API access. Upgrade your plan from https://www.apollo.io/pricing",
          error_code: "API_INACCESSIBLE",
          error_details: {
            code: "AUTH.AUTHORIZATION.ENDPOINT_ACCESS_DENIED",
            message: "Your team is not permitted to call this endpoint.",
          },
        },
        403,
      ),
    );
    await expect(new ApolloEnrichmentProvider().searchPeople({ domain: "x.com", orgName: "X", city: null, state: null, metro: null }, 5)).rejects.toBeInstanceOf(
      ProviderPlanError,
    );
    // error_code wins over error_details.code when both are present.
    expect(providerConfigMock.upsert.mock.calls[0][0]).toMatchObject({ update: { planBlockDetail: "API_INACCESSIBLE" } });
  });

  it("classifies a 403 body with only error_details.code set (no top-level error_code) as a plan block, using error_details.code as detail", async () => {
    mockFetch(() =>
      json(
        {
          error_details: {
            code: "AUTH.AUTHORIZATION.ENDPOINT_ACCESS_DENIED",
            message: "Your team is not permitted to call this endpoint.",
          },
        },
        403,
      ),
    );
    await expect(new ApolloEnrichmentProvider().searchPeople({ domain: "x.com", orgName: "X", city: null, state: null, metro: null }, 5)).rejects.toBeInstanceOf(
      ProviderPlanError,
    );
    expect(providerConfigMock.upsert.mock.calls[0][0]).toMatchObject({
      update: { planBlockDetail: "AUTH.AUTHORIZATION.ENDPOINT_ACCESS_DENIED" },
    });
  });

  it("a plain 403 (no API_INACCESSIBLE) throws a generic HTTP error and is never memoized", async () => {
    mockFetch(() => json({ error: "forbidden" }, 403));
    await expect(new ApolloEnrichmentProvider().searchPeople({ domain: "x.com", orgName: "X", city: null, state: null, metro: null }, 5)).rejects.toThrow(
      /Apollo \/mixed_people\/api_search HTTP 403/,
    );
    // Not memoized: a second call re-fetches instead of throwing from a cached block.
    await expect(new ApolloEnrichmentProvider().searchPeople({ domain: "x.com", orgName: "X", city: null, state: null, metro: null }, 5)).rejects.toThrow(/HTTP 403/);
    expect(calls).toHaveLength(2);
    expect(providerConfigMock.upsert).not.toHaveBeenCalled();
  });

  it("the 6h plan-block memo expires: a call after the TTL re-hits the network instead of short-circuiting", async () => {
    vi.useFakeTimers();
    try {
      mockFetch(() => json({ error: "not included in your Free plan", error_code: "API_INACCESSIBLE" }, 403));
      const provider = new ApolloEnrichmentProvider();
      await expect(provider.searchPeople({ domain: "x.com", orgName: "X", city: null, state: null, metro: null }, 5)).rejects.toBeInstanceOf(ProviderPlanError);
      expect(calls).toHaveLength(1);

      // Still within the 6h window: short-circuits without a new fetch.
      await expect(provider.searchPeople({ domain: "x.com", orgName: "X", city: null, state: null, metro: null }, 5)).rejects.toBeInstanceOf(ProviderPlanError);
      expect(calls).toHaveLength(1);

      // Advance past the 6h TTL: the memo should no longer block, so the next call re-fetches.
      vi.advanceTimersByTime(6 * 60 * 60 * 1000 + 1000);
      mockFetch(() => json({ total_entries: 0, people: [] }));
      await expect(provider.searchPeople({ domain: "x.com", orgName: "X", city: null, state: null, metro: null }, 5)).resolves.toEqual({ people: [], totalFound: 0, totalAtDomain: 0, scope: "any" });
      expect(calls).toHaveLength(1); // mockFetch() reset the calls array; this is the post-expiry fetch
    } finally {
      vi.useRealTimers();
    }
  });

  it("apolloPlanBlocked() reports unblocked once the in-process memo has expired (with no persisted row)", async () => {
    __setPlanBlockedForTests(PEOPLE_SEARCH_PATH, Date.now() - 1000);
    providerConfigMock.findUnique.mockResolvedValue(null);
    expect(await apolloPlanBlocked()).toEqual({ blocked: false });
  });

  // M1: apolloPlanBlocked() must revalidate a "blocked" memo against the persisted row, not trust
  // it outright — otherwise a Settings save that clears the block in another web process/replica
  // would never take effect here until this process's memo happened to expire on its own.
  it("apolloPlanBlocked() revalidates a live memo against the row: row cleared -> unblocked and the memo is dropped", async () => {
    __setPlanBlockedForTests(PEOPLE_SEARCH_PATH, Date.now() + 60_000, "API_INACCESSIBLE");
    providerConfigMock.findUnique.mockResolvedValueOnce(null); // Settings save cleared the row
    expect(await apolloPlanBlocked()).toEqual({ blocked: false });
    expect(providerConfigMock.findUnique).toHaveBeenCalledTimes(1);

    // The memo is gone provider-wide, not just for PEOPLE_SEARCH_PATH: a follow-up call to the
    // low-level checkPlanBlocked gate (via searchPeople) proceeds to the network instead of
    // throwing from a stale block.
    mockFetch(() => json({ total_entries: 0, people: [] }));
    await expect(new ApolloEnrichmentProvider().searchPeople({ domain: "x.com", orgName: "X", city: null, state: null, metro: null }, 5)).resolves.toEqual({ people: [], totalFound: 0, totalAtDomain: 0, scope: "any" });
    expect(calls).toHaveLength(1);
  });

  describe("D1: checkPlanBlocked revalidates a memoized block against the persisted row", () => {
    it("memo says blocked but the row was cleared (e.g. a Settings key save in the web process): the call proceeds to the network, and the memo is dropped entirely", async () => {
      __setPlanBlockedForTests(PEOPLE_SEARCH_PATH, Date.now() + 60_000);
      providerConfigMock.findUnique.mockResolvedValueOnce(null); // row cleared
      mockFetch(() => json({ total_entries: 0, people: [] }));
      const provider = new ApolloEnrichmentProvider();
      await expect(provider.searchPeople({ domain: "x.com", orgName: "X", city: null, state: null, metro: null }, 5)).resolves.toEqual({ people: [], totalFound: 0, totalAtDomain: 0, scope: "any" });
      expect(calls).toHaveLength(1); // proceeded to the network instead of throwing
      expect(providerConfigMock.findUnique).toHaveBeenCalledTimes(1); // exactly one revalidation read

      // The memo was dropped entirely (the block is provider-wide, not per-path): a further call
      // takes checkPlanBlocked's "memo empty" fast path, so no additional DB read happens even
      // though findUnique's mock is still wired up.
      mockFetch(() => json({ total_entries: 0, people: [] }));
      await expect(provider.searchPeople({ domain: "x.com", orgName: "X", city: null, state: null, metro: null }, 5)).resolves.toEqual({ people: [], totalFound: 0, totalAtDomain: 0, scope: "any" });
      expect(providerConfigMock.findUnique).toHaveBeenCalledTimes(1);
    });

    it("memo says blocked and the row still is: revalidation confirms the block and throws without any network call", async () => {
      __setPlanBlockedForTests(PEOPLE_SEARCH_PATH, Date.now() + 60_000, "API_INACCESSIBLE");
      providerConfigMock.findUnique.mockResolvedValueOnce({ planBlockedUntil: new Date(Date.now() + 60_000), planBlockDetail: "API_INACCESSIBLE" });
      mockFetch(() => { throw new Error("should not fetch: still blocked"); });
      await expect(new ApolloEnrichmentProvider().searchPeople({ domain: "x.com", orgName: "X", city: null, state: null, metro: null }, 5)).rejects.toBeInstanceOf(
        ProviderPlanError,
      );
      expect(calls).toHaveLength(0);
      expect(providerConfigMock.findUnique).toHaveBeenCalledTimes(1);
    });

    it("the unblocked path (memo never set) makes zero extra ProviderConfig reads", async () => {
      mockFetch(() => json({ total_entries: 0, people: [] }));
      await new ApolloEnrichmentProvider().searchPeople({ domain: "x.com", orgName: "X", city: null, state: null, metro: null }, 5);
      expect(providerConfigMock.findUnique).not.toHaveBeenCalled();
    });
  });

  describe("D2: a failed persist must not change classification", () => {
    it("markPlanBlocked's upsert rejecting still throws ProviderPlanError, still sets the memo, but the block degrades to one 403 per job (no row to revalidate against, so the next call re-fetches instead of short-circuiting)", async () => {
      providerConfigMock.upsert.mockRejectedValueOnce(new Error("connection reset"));
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        mockFetch(() => json({ error: "not included in your Free plan", error_code: "API_INACCESSIBLE" }, 403));
        const provider = new ApolloEnrichmentProvider();
        await expect(provider.searchPeople({ domain: "x.com", orgName: "X", city: null, state: null, metro: null }, 5)).rejects.toBeInstanceOf(ProviderPlanError);
        expect(calls).toHaveLength(1);
        expect(consoleErrorSpy).toHaveBeenCalled(); // logged, not silently swallowed

        // The memo is set, but because the persist failed there's no ProviderConfig row for the
        // next call's revalidation read to confirm — so it comes back null (as if a Settings save
        // had cleared it), the memo is dropped, and the call proceeds to the network rather than
        // throwing from the cache. This documents the real degraded behavior after a failed
        // persist: "skipped, not retried" only holds for the single job that hit the live 403;
        // every job after it re-hits the network (and re-403s) until a persist finally succeeds.
        providerConfigMock.findUnique.mockResolvedValueOnce(null);
        mockFetch(() => json({ error: "not included in your Free plan", error_code: "API_INACCESSIBLE" }, 403));
        await expect(provider.searchPeople({ domain: "x.com", orgName: "X", city: null, state: null, metro: null }, 5)).rejects.toBeInstanceOf(ProviderPlanError);
        expect(calls).toHaveLength(1); // re-fetched (mockFetch reset calls) instead of short-circuiting
      } finally {
        consoleErrorSpy.mockRestore();
      }
    });
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

describe("ApolloEnrichmentProvider.creditUsage", () => {
  const usageBody = {
    credit_usage_stats: { lead_credit: { limit: 2510, consumed: 2, left_over: 2508 } },
    current_credit_cycle: { start_date: "2026-09-17T04:58:17.000+00:00", end_date: "2026-10-17T04:58:17.000+00:00" },
  };

  beforeEach(() => {
    __resetCreditUsageForTests();
    __resetPlanBlockedForTests();
  });

  it("maps lead_credit and the cycle dates; memoizes for the TTL", async () => {
    const fetchMock = vi.fn(async () => json(usageBody, 200));
    vi.stubGlobal("fetch", fetchMock);
    const p = new ApolloEnrichmentProvider();
    const u1 = await p.creditUsage();
    expect(u1).toMatchObject({ limit: 2510, consumed: 2, leftOver: 2508 });
    expect(u1!.cycleEnd.toISOString()).toBe("2026-10-17T04:58:17.000Z");
    await p.creditUsage();
    expect(fetchMock).toHaveBeenCalledTimes(1); // memoized
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.apollo.io/api/v1/usage_stats/credit_usage_stats");
    expect(init.method).toBe("POST");
    expect(url).not.toContain("api_key");
  });

  it("returns null on a non-200 and on a network error, and does not memoize failures", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ error: "forbidden" }, 403))
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce(json(usageBody, 200));
    vi.stubGlobal("fetch", fetchMock);
    const p = new ApolloEnrichmentProvider();
    expect(await p.creditUsage()).toBeNull();
    expect(await p.creditUsage()).toBeNull();
    expect(await p.creditUsage()).toMatchObject({ leftOver: 2508 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("returns null without a key and makes no request", async () => {
    vi.mocked(getProviderKey).mockResolvedValueOnce(null); // the file already mocks @/lib/providers/keys
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await new ApolloEnrichmentProvider().creditUsage()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // M1 (whole-branch review): a bare fetch with no timeout now runs on user-facing routes
  // (Settings, credits, both enrich routes' assertCredits) and runEnrich, so a hanging Apollo
  // response used to be able to hang all of them. Deterministic per the review note: mock
  // AbortSignal.timeout itself (rather than depending on whether Vitest's fake timers happen to
  // drive Node's internal AbortSignal.timeout implementation) — the signal is pre-aborted before
  // creditUsage() is even called, so there's no race between the fetch mock attaching its "abort"
  // listener and the abort firing (a signal that's already aborted before a listener is attached
  // never fires that listener — mirroring real fetch()'s own "reject immediately if already
  // aborted" contract, which is why the mock below checks `signal.aborted` up front too).
  it("passes an AbortSignal.timeout(ENRICH_CONFIG.creditUsageTimeoutMs) signal, and resolves null (via the existing catch-all) when that signal is aborted", async () => {
    const controller = new AbortController();
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    try {
      const fetchMock = vi.fn((_url: string, init: RequestInit) => {
        const signal = init.signal as AbortSignal;
        if (signal.aborted) return Promise.reject(new DOMException("The operation was aborted.", "AbortError"));
        return new Promise<Response>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
        });
      });
      vi.stubGlobal("fetch", fetchMock);
      controller.abort(); // simulates the configured timeout having already fired
      const result = await new ApolloEnrichmentProvider().creditUsage();
      expect(result).toBeNull();
      expect(timeoutSpy).toHaveBeenCalledWith(ENRICH_CONFIG.creditUsageTimeoutMs);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      timeoutSpy.mockRestore();
    }
  });
});

// L6 (whole-branch review): clearPlanBlock("apollo") is called on a Settings key save/re-enable —
// exactly when the account behind the key may have changed. Without resetting creditUsageMemo
// there too, a new key could keep showing the previous key's balance for up to creditUsageTtlMs
// (5 min), since the memo is process-wide and keyed by nothing but time.
describe("clearPlanBlock resets the creditUsage memo (L6)", () => {
  beforeEach(() => {
    providerConfigMock.updateMany.mockClear();
    __resetCreditUsageForTests();
  });
  afterEach(() => __resetPlanBlockedForTests());

  it("a memoized balance is gone after clearPlanBlock('apollo'), so the next creditUsage() call re-fetches", async () => {
    const usageBody = {
      credit_usage_stats: { lead_credit: { limit: 100, consumed: 0, left_over: 100 } },
      current_credit_cycle: { start_date: "2026-09-17T00:00:00.000Z", end_date: "2026-10-17T00:00:00.000Z" },
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(usageBody), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const p = new ApolloEnrichmentProvider();

    const u1 = await p.creditUsage();
    expect(u1).toMatchObject({ leftOver: 100 });
    await p.creditUsage();
    expect(fetchMock).toHaveBeenCalledTimes(1); // memoized, as usual

    await clearPlanBlock("apollo");

    const newUsageBody = {
      credit_usage_stats: { lead_credit: { limit: 2510, consumed: 2, left_over: 2508 } },
      current_credit_cycle: { start_date: "2026-09-17T00:00:00.000Z", end_date: "2026-10-17T00:00:00.000Z" },
    };
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(newUsageBody), { status: 200, headers: { "content-type": "application/json" } }));
    const u2 = await p.creditUsage();
    expect(fetchMock).toHaveBeenCalledTimes(2); // re-fetched instead of returning the stale memo
    expect(u2).toMatchObject({ leftOver: 2508 }); // the new key's own balance, not the old one's
  });
});
