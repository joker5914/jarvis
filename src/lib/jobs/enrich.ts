import { prisma } from "@/lib/db";
import { checkPause, upsertIgnoringConflict, type JobDeps } from "./shared";
import { validateEmails, recomputeContactQuality } from "./zipSearch";
import { ENRICH_CONFIG } from "@/lib/config/enrichment";
import { BudgetExhaustedError } from "@/lib/providers/budget";
import { ProviderNotConfiguredError } from "@/lib/providers/errors";
import type { EnrichPerson } from "@/lib/providers/types";

const SOCIAL_HOSTS = ["facebook.com", "instagram.com", "linkedin.com", "yelp.com", "twitter.com", "x.com", "sites.google.com", "business.site", "wixsite.com", "squarespace.com", "godaddysites.com"];

export function domainFromUrl(url: string | null): string | null {
  if (!url) return null;
  const raw = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  try {
    const host = new URL(raw).hostname.toLowerCase().replace(/^www\./, "");
    if (!host.includes(".")) return null;
    if (SOCIAL_HOSTS.some((s) => host === s || host.endsWith(`.${s}`))) return null;
    return host;
  } catch {
    return null;
  }
}

export function cityFromAddress(addr: string | null): string | null {
  if (!addr) return null;
  const parts = addr.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.length === 1) return null;
  const last = parts[parts.length - 1];
  const isCountry = /^(usa|united states|us)$/i.test(last);
  const stateZipIdx = isCountry ? parts.length - 2 : parts.length - 1;
  const city = parts[stateZipIdx - 1];
  return city && !/\d/.test(city) ? city : null;
}

function canonicalLinkedin(url: string): string {
  const u = new URL(url);
  return `https://www.linkedin.com${u.pathname.replace(/\/+$/, "")}`;
}

export async function runEnrich(
  businessId: string,
  ownerId: string,
  deps: JobDeps,
): Promise<{ added: number; updated: number; skipped: "excluded" | "not_found" | null }> {
  const b = await prisma.business.findFirst({ where: { id: businessId, ownerId } });
  if (!b) return { added: 0, updated: 0, skipped: "not_found" as const };
  if (b.exclusion !== "none") return { added: 0, updated: 0, skipped: "excluded" as const };
  const log = (message: string) => prisma.activityLog.create({ data: { ownerId, businessId, kind: "enriched", message } });
  let added = 0;
  let updated = 0;
  try {
    await checkPause(deps);
    const domain = domainFromUrl(b.websiteUrl);
    const people = await deps.providers.enrichment.searchPeople({ domain, orgName: b.name, city: cityFromAddress(b.formattedAddress) }, ENRICH_CONFIG.maxPeople);
    for (const p of people.slice(0, ENRICH_CONFIG.maxPeople)) {
      await checkPause(deps);
      const full: EnrichPerson | null = p.email ? p : await deps.providers.enrichment.enrichPerson(p.apolloId);
      if (!full) continue;
      const personName = full.name;
      const personTitle = full.title;
      const rows: { type: "email" | "linkedin"; value: string }[] = [];
      if (full.email) rows.push({ type: "email", value: full.email.toLowerCase() });
      if (full.linkedinUrl) rows.push({ type: "linkedin", value: canonicalLinkedin(full.linkedinUrl) });
      // added/updated are counted per person (at most one increment to each per person, per
      // run), not per contact row: a person with both a fresh email and a fresh LinkedIn row
      // still counts once toward `added`, matching how the API/UI report "N people enriched".
      let personAdded = false;
      let personUpdated = false;
      for (const r of rows) {
        const existing = await prisma.contact.findUnique({ where: { businessId_type_value: { businessId, type: r.type, value: r.value } } });
        if (existing) {
          if ((!existing.personName && personName) || (!existing.personTitle && personTitle)) {
            await prisma.contact.update({ where: { id: existing.id }, data: { personName: existing.personName ?? personName, personTitle: existing.personTitle ?? personTitle } });
            personUpdated = true;
          }
          continue;
        }
        await upsertIgnoringConflict(() =>
          prisma.contact.create({ data: { ownerId, businessId, type: r.type, value: r.value, source: "apollo", personName, personTitle } }),
        );
        personAdded = true;
      }
      if (personAdded) added++;
      if (personUpdated) updated++;
    }
    await validateEmails([businessId], deps);
    await recomputeContactQuality(businessId);
    await prisma.business.update({ where: { id: businessId }, data: { lastEnrichedAt: new Date() } });
    await log(`Enriched via Apollo: ${added} new contact${added === 1 ? "" : "s"}, ${updated} updated`);
    return { added, updated, skipped: null };
  } catch (e) {
    if (e instanceof BudgetExhaustedError) await log("Enrichment paused: Apollo daily budget exhausted");
    else if (e instanceof ProviderNotConfiguredError) await log("Enrichment skipped: Apollo API key is not configured");
    throw e;
  }
}
