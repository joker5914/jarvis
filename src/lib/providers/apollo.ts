import { withBudget } from "./budget";
import { getProviderKey } from "./keys";
import { ProviderNotConfiguredError } from "./errors";
import { ENRICH_CONFIG } from "@/lib/config/enrichment";
import type { EnrichPerson, EnrichmentProvider } from "./types";

const BASE = "https://api.apollo.io/api/v1";

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

export class ApolloEnrichmentProvider implements EnrichmentProvider {
  async searchPeople(q: { domain: string | null; orgName: string; city: string | null }, max: number): Promise<EnrichPerson[]> {
    const key = await requireKey();
    const body: Record<string, unknown> = {
      person_titles: [...ENRICH_CONFIG.preferredTitles],
      include_similar_titles: true,
      person_seniorities: [...ENRICH_CONFIG.seniorities],
      per_page: max,
      page: 1,
    };
    if (q.domain) body.q_organization_domains_list = [q.domain];
    else {
      body.q_keywords = q.orgName;
      if (q.city) body.organization_locations = [q.city];
    }
    const data = await withBudget("apollo", async () => {
      const res = await fetch(`${BASE}/mixed_people/api_search`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", "x-api-key": key },
        body: JSON.stringify(body),
      });
      if (res.status === 422) return { people: [] as SearchPerson[] };
      if (!res.ok) throw new Error(`Apollo search HTTP ${res.status}`);
      return (await res.json()) as { people?: SearchPerson[] };
    });
    const people = (data.people ?? []).map<EnrichPerson>((p) => ({
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
    const key = await requireKey();
    const url = new URL(`${BASE}/people/match`);
    url.searchParams.set("id", apolloId);
    url.searchParams.set("reveal_personal_emails", "false");
    url.searchParams.set("reveal_phone_number", "false");
    const data = await withBudget("apollo", async () => {
      const res = await fetch(url.href, { method: "POST", headers: { accept: "application/json", "x-api-key": key } });
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
