import { withBudget } from "./budget";
import { getProviderKey } from "./keys";
import { ProviderNotConfiguredError, ProviderPlanError } from "./errors";
import { ENRICH_CONFIG } from "@/lib/config/enrichment";
import { normalizeName } from "@/lib/jobs/shared";
import type { EnrichPerson, EnrichmentProvider } from "./types";

const BASE = "https://api.apollo.io/api/v1";
export const ORG_SEARCH_PATH = "/mixed_companies/search";
export const PEOPLE_SEARCH_PATH = "/mixed_people/api_search";
export const PEOPLE_MATCH_PATH = "/people/match";

const PLAN_BLOCK_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

/** Path -> epoch ms until which that Apollo endpoint is known to be plan-blocked (403
 * API_INACCESSIBLE). Module-level so it survives across calls within the same process; a fresh
 * deploy/restart clears it, which is fine since the next call re-derives it from a real 403. */
const planBlockedUntil = new Map<string, number>();
/** Path -> the provider's own explanation text for the most recent plan block, kept alongside
 * planBlockedUntil so apolloPlanBlocked() can surface it without a network call. */
const planBlockedDetail = new Map<string, string>();

function markPlanBlocked(path: string, detail: string) {
  planBlockedUntil.set(path, Date.now() + PLAN_BLOCK_TTL_MS);
  planBlockedDetail.set(path, detail);
}

/** Throws ProviderPlanError with no network call when `path` was recently 403'd as
 * plan-inaccessible; a no-op otherwise (including once the 6h memo has expired). */
function checkPlanBlocked(path: string): void {
  const until = planBlockedUntil.get(path);
  if (until !== undefined && until > Date.now()) {
    throw new ProviderPlanError("apollo", path, planBlockedDetail.get(path) ?? "API_INACCESSIBLE");
  }
}

/** True when Apollo's plan is known (within the last 6h) to not include the People Search /
 * People Enrichment APIs this app relies on for lead enrichment. Used by the enrich routes to
 * refuse before even queuing a job. Fake provider mode never populates the memo, so this always
 * reports unblocked there. */
export function apolloPlanBlocked(): { blocked: boolean; detail?: string } {
  const now = Date.now();
  for (const path of [PEOPLE_SEARCH_PATH, ORG_SEARCH_PATH, PEOPLE_MATCH_PATH]) {
    const until = planBlockedUntil.get(path);
    if (until !== undefined && until > now) {
      return { blocked: true, detail: planBlockedDetail.get(path) };
    }
  }
  return { blocked: false };
}

/** Test-only: forces the plan-block memo for one Apollo path without a real 403, so route tests
 * can exercise the 409 gate without mocking fetch. Not used by app code. */
export function __setPlanBlockedForTests(path: string, untilEpochMs: number, detail = "test-forced plan block"): void {
  planBlockedUntil.set(path, untilEpochMs);
  planBlockedDetail.set(path, detail);
}

/** Test-only: clears the plan-block memo entirely (all paths). Call in afterEach/afterAll so a
 * forced block from one test doesn't leak into the next. */
export function __resetPlanBlockedForTests(): void {
  planBlockedUntil.clear();
  planBlockedDetail.clear();
}

type ApolloErrorBody = { error?: string; error_code?: string };

/** Apollo's Free plan returns 403 API_INACCESSIBLE (with an explanatory `error` string) for
 * People Search/Enrichment even with a valid key — distinct from a real auth/permissions 403.
 * Reads the body once to tell the two apart, memoizes a plan block so this process stops hitting
 * the endpoint for a while, and always throws (never returns). The raw `error_code` (falling back
 * to "API_INACCESSIBLE" when matched only via the error text) is kept as `detail` for diagnosis
 * in the activity log — never the human-facing message, which lives on ProviderPlanError itself. */
async function throwFor403(path: string, res: Response): Promise<never> {
  let body: ApolloErrorBody | null = null;
  try {
    body = (await res.json()) as ApolloErrorBody;
  } catch {
    // Non-JSON body: fall through to the generic 403 below.
  }
  const errorText = body?.error ?? "";
  if (body?.error_code === "API_INACCESSIBLE" || /not included in your/i.test(errorText)) {
    const detail = body?.error_code ?? "API_INACCESSIBLE";
    markPlanBlocked(path, detail);
    throw new ProviderPlanError("apollo", path, detail);
  }
  throw new Error(`Apollo ${path} HTTP 403`);
}

type SearchPerson = { id: string; first_name?: string | null; last_name_obfuscated?: string | null; title?: string | null; has_email?: boolean | null };
type MatchPerson = { id: string; first_name?: string | null; last_name?: string | null; name?: string | null; title?: string | null; email?: string | null; email_status?: string | null; linkedin_url?: string | null; match_confidence?: string | null };

async function requireKey() {
  const key = await getProviderKey("apollo");
  if (!key) throw new ProviderNotConfiguredError("apollo");
  return key;
}

function titleRank(title: string | null | undefined): number {
  const t = (title ?? "").toLowerCase();
  const i = ENRICH_CONFIG.preferredTitles.findIndex((p) => t.includes(p));
  return i === -1 ? ENRICH_CONFIG.preferredTitles.length : i;
}

function qs(params: Record<string, string | number | boolean | string[] | undefined>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) for (const item of v) u.append(`${k}[]`, item);
    else u.set(k, String(v));
  }
  return u.toString();
}

async function post<T>(key: string, path: string, params: Record<string, string | number | boolean | string[] | undefined>): Promise<{ status: number; data: T | null }> {
  const res = await fetch(`${BASE}${path}?${qs(params)}`, {
    method: "POST",
    headers: { accept: "application/json", "x-api-key": key },
  });
  if (res.status === 422) return { status: 422, data: null };
  if (res.status === 403) await throwFor403(path, res);
  if (!res.ok) throw new Error(`Apollo ${path} HTTP ${res.status}`);
  return { status: res.status, data: (await res.json()) as T };
}

type OrgSearchResponse = { organizations?: { id: string; name?: string | null; primary_domain?: string | null }[] };

/**
 * normalizeName already strips "&" (a non-alphanumeric char) but leaves the word "and" alone,
 * so "Bella Nails & Spa" and "Bella Nails and Spa" normalize to different strings. Fold both
 * tokens out here so the two spellings compare equal.
 */
function normalizeForOrgCompare(name: string): string {
  return normalizeName(name)
    .replace(/\band\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Guards against Apollo's org search returning a plausible-looking but different organization
 * (e.g. request "Joe's" matching org "Joe's Crab Shack" on naive substring containment). Accept
 * only an exact match, or a containment where the shorter side has at least two words — a
 * single-word request must match exactly.
 */
function orgNameMatches(requested: string, found: string): boolean {
  if (!requested || !found) return false;
  if (requested === found) return true;
  const [shorter, longer] = requested.length <= found.length ? [requested, found] : [found, requested];
  const shorterWordCount = shorter.split(" ").filter(Boolean).length;
  return shorterWordCount >= 2 && longer.includes(shorter);
}

export class ApolloEnrichmentProvider implements EnrichmentProvider {
  async searchOrganization(name: string, city: string | null): Promise<{ id: string; primaryDomain: string | null } | null> {
    checkPlanBlocked(ORG_SEARCH_PATH);
    const key = await requireKey();
    const r = await withBudget("apollo", () =>
      post<OrgSearchResponse>(key, ORG_SEARCH_PATH, {
        q_organization_name: name,
        organization_locations: city ? [city] : undefined,
        per_page: 1,
        page: 1,
      }),
    );
    const org = r.data?.organizations?.[0];
    if (!org) return null;
    if (!orgNameMatches(normalizeForOrgCompare(name), normalizeForOrgCompare(org.name ?? ""))) return null;
    return { id: org.id, primaryDomain: org.primary_domain ?? null };
  }

  async searchPeople(q: { domain: string | null; orgName: string; city: string | null }, max: number): Promise<EnrichPerson[]> {
    checkPlanBlocked(PEOPLE_SEARCH_PATH);
    const key = await requireKey();
    const base: Record<string, string | number | boolean | string[] | undefined> = {
      person_titles: [...ENRICH_CONFIG.preferredTitles],
      include_similar_titles: true,
      person_seniorities: [...ENRICH_CONFIG.seniorities],
      per_page: max,
      page: 1,
    };
    let filter: Record<string, string | number | boolean | string[] | undefined>;
    if (q.domain) {
      filter = { q_organization_domains_list: [q.domain] };
    } else {
      const org = await this.searchOrganization(q.orgName, q.city);
      if (!org) return [];
      filter = org.primaryDomain ? { q_organization_domains_list: [org.primaryDomain] } : { organization_ids: [org.id] };
    }
    const r = await withBudget("apollo", () =>
      post<{ people?: SearchPerson[] }>(key, PEOPLE_SEARCH_PATH, { ...base, ...filter }),
    );
    const people = (r.data?.people ?? []).map<EnrichPerson>((p) => ({
      apolloId: p.id,
      firstName: p.first_name ?? null,
      lastName: null, // search results obfuscate last names
      name: p.first_name ?? null,
      title: p.title ?? null,
      email: null,
      emailStatus: null,
      linkedinUrl: null,
      hasEmail: !!p.has_email,
    }));
    people.sort((a, b) => titleRank(a.title) - titleRank(b.title) || Number(b.hasEmail) - Number(a.hasEmail));
    return people.slice(0, max);
  }

  async enrichPerson(apolloId: string): Promise<EnrichPerson | null> {
    checkPlanBlocked(PEOPLE_MATCH_PATH);
    const key = await requireKey();
    const url = new URL(`${BASE}${PEOPLE_MATCH_PATH}`);
    url.searchParams.set("id", apolloId);
    url.searchParams.set("reveal_personal_emails", "false");
    url.searchParams.set("reveal_phone_number", "false");
    const data = await withBudget("apollo", async () => {
      const res = await fetch(url.href, { method: "POST", headers: { accept: "application/json", "x-api-key": key } });
      if (res.status === 403) await throwFor403(PEOPLE_MATCH_PATH, res);
      if (!res.ok) throw new Error(`Apollo match HTTP ${res.status}`);
      return (await res.json()) as { person?: MatchPerson | null };
    });
    const p = data.person;
    if (!p || p.match_confidence === "none") return null;
    return {
      apolloId: p.id,
      firstName: p.first_name ?? null,
      lastName: p.last_name ?? null,
      name: p.name ?? ([p.first_name, p.last_name].filter(Boolean).join(" ") || null),
      title: p.title ?? null,
      email: p.email ?? null,
      emailStatus: p.email_status ?? null,
      linkedinUrl: p.linkedin_url ?? null,
      hasEmail: !!p.email,
    };
  }
}
