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

/**
 * Guards against a malformed or non-LinkedIn URL from the provider: accepts scheme-less input,
 * requires the host to actually be linkedin.com (or a subdomain), and returns null rather than
 * throwing on anything else so the caller can skip just that one contact row instead of
 * aborting the whole business.
 */
export function canonicalLinkedin(url: string): string | null {
  const raw = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();
    if (host !== "linkedin.com" && !host.endsWith(".linkedin.com")) return null;
    return `https://www.linkedin.com${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

export async function runEnrich(
  businessId: string,
  ownerId: string,
  deps: JobDeps,
  opts: { force?: boolean } = {},
): Promise<{ added: number; updated: number; skipped: "excluded" | "not_found" | "recent" | null }> {
  const b = await prisma.business.findFirst({ where: { id: businessId, ownerId } });
  if (!b) return { added: 0, updated: 0, skipped: "not_found" as const };
  if (b.exclusion !== "none") return { added: 0, updated: 0, skipped: "excluded" as const };
  const log = (message: string) => prisma.activityLog.create({ data: { ownerId, businessId, kind: "enriched", message } });
  if (!opts.force && b.lastEnrichedAt) {
    const daysSince = Math.floor((Date.now() - b.lastEnrichedAt.getTime()) / 86_400_000);
    if (daysSince < ENRICH_CONFIG.recheckDays) {
      await log(`Enrichment skipped: enriched ${daysSince} day(s) ago (use Re-enrich to refresh)`);
      return { added: 0, updated: 0, skipped: "recent" as const };
    }
  }
  let added = 0;
  let updated = 0;
  let contactRows = 0;
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
      if (full.linkedinUrl) {
        const li = canonicalLinkedin(full.linkedinUrl);
        if (li) rows.push({ type: "linkedin", value: li });
      }
      // added/updated are counted per person (at most one increment to each per person, per
      // run), not per contact row: a person with both a fresh email and a fresh LinkedIn row
      // still counts once toward `added`, matching how the API/UI report "N people enriched".
      // contactRows tracks the raw row count separately, for the activity message.
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
        contactRows++;
      }
      if (personAdded) added++;
      if (personUpdated) updated++;
    }
    await validateEmails([businessId], deps);
    await recomputeContactQuality(businessId);
    await prisma.business.update({ where: { id: businessId }, data: { lastEnrichedAt: new Date() } });
    await log(`Enriched via Apollo: ${added} ${added === 1 ? "person" : "people"}, ${contactRows} new contact${contactRows === 1 ? "" : "s"}, ${updated} updated`);
    return { added, updated, skipped: null };
  } catch (e) {
    if (e instanceof BudgetExhaustedError) await log("Enrichment paused: Apollo daily budget exhausted");
    else if (e instanceof ProviderNotConfiguredError) await log("Enrichment skipped: Apollo API key is not configured");
    throw e;
  }
}
