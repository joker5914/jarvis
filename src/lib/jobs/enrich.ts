import { prisma } from "@/lib/db";
import { checkPause, upsertIgnoringConflict, type JobDeps } from "./shared";
import { validateEmails, recomputeContactQuality } from "./zipSearch";
import { ENRICH_CONFIG } from "@/lib/config/enrichment";
import { loadConfig } from "@/lib/config/runtime";
import { creditStatus } from "@/lib/enrichment/credits";
import { BudgetExhaustedError } from "@/lib/providers/budget";
import { CreditCapReachedError, ProviderNotConfiguredError, ProviderDisabledError, ProviderPlanError } from "@/lib/providers/errors";
import { orgNameMatches } from "@/lib/providers/apollo";
import { PLATFORM_EMAIL_DOMAINS } from "@/lib/extract/platformDomains";
import type { EnrichPerson } from "@/lib/providers/types";

// Hosts that never identify a business's own domain: social/review profile pages (the original
// set) plus, per live zero-credit probes, booking/scheduling/ordering platforms whose page for a
// lead (e.g. a Booksy or Clover storefront) makes Apollo's People Search return the *platform's*
// executives instead of the lead's — see orgNameMatches below for the second half of that guard.
//
// The platform half used to be its own hand-maintained list here, which diverged from
// `PLATFORM_EMAIL_DOMAINS` in src/lib/extract/platformDomains.ts (same category of domain, just
// checked against a website URL instead of an email address) — whole-branch review item L2.
// `PLATFORM_EMAIL_DOMAINS` is now the one source of truth for "this domain is a shared platform,
// never a lead's own"; this is just the social/review hosts that PLATFORM_EMAIL_DOMAINS doesn't
// need to carry (an email at facebook.com etc. is already covered separately by
// PLACEHOLDER_EMAIL_RE/isPlatformEmail's own social entries — see that module) unioned with it.
const SOCIAL_HOSTS = ["facebook.com", "instagram.com", "linkedin.com", "yelp.com", "twitter.com", "x.com"];
const SHARED_HOSTS = [...new Set([...SOCIAL_HOSTS, ...PLATFORM_EMAIL_DOMAINS])];

export function domainFromUrl(url: string | null): string | null {
  if (!url) return null;
  const raw = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  try {
    const host = new URL(raw).hostname.toLowerCase().replace(/^www\./, "");
    if (!host.includes(".")) return null;
    if (SHARED_HOSTS.some((s) => host === s || host.endsWith(`.${s}`))) return null;
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
  opts: { force?: boolean; people?: number } = {},
): Promise<{ added: number; updated: number; skipped: "excluded" | "not_found" | "recent" | "org_mismatch" | null }> {
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
  const cfg = await loadConfig(ownerId);
  const maxPeople = Math.min(ENRICH_CONFIG.maxPeopleLimit, Math.max(1, opts.people ?? cfg.enrichment.maxPeople));
  const status = await creditStatus(ownerId, cfg);
  const { used, cap } = status;
  let remaining = status.remaining;
  if (remaining <= 0) {
    await log("Enrichment skipped: Apollo monthly credit cap reached");
    throw new CreditCapReachedError(used, cap);
  }
  let added = 0;
  let updated = 0;
  let contactRows = 0;
  try {
    await checkPause(deps);
    const domain = domainFromUrl(b.websiteUrl);
    const people = await deps.providers.enrichment.searchPeople({ domain, orgName: b.name, city: cityFromAddress(b.formattedAddress) }, maxPeople);
    // Set when a candidate's own orgName (from Apollo's search hit) doesn't match this business —
    // e.g. the lead's website is a page hosted on a shared booking/ordering platform (see
    // SHARED_HOSTS above), so People Search returned the platform's own staff instead. Tracked
    // across the whole loop so a business where *every* candidate mismatches gets one explanatory
    // activity row (below) instead of the generic "0 people" success message.
    let skippedOrg: string | null = null;
    // Counts people who actually came back with a verified email this run (via the free search's
    // hasEmail flag, or a paid reveal that confirmed one) — distinct from `added`, which only
    // counts people who produced a *new* contact row (an already-known email doesn't increment
    // `added` but should still count toward "N people with a verified email" in the activity
    // message below).
    let withEmail = 0;
    for (const p of people.slice(0, maxPeople)) {
      await checkPause(deps);
      // Apollo's obfuscated search rows carry `organization.name` but no domain, so a name check
      // is the only guard available here — reject before spending a credit on a wrong-company hit.
      // Only on the no-domain branch: when the search was filtered by the lead's own website
      // domain, Apollo already matched on a stronger signal than the name, and the org that owns
      // a domain often trades under a different name ("Dr. Jane Smith DDS" → Pearland Family
      // Dentistry). The wrong-company sink this guards against (shared booking/ordering platforms)
      // has domain === null by construction (see SHARED_HOSTS).
      if (!domain && p.orgName && !orgNameMatches(p.orgName, b.name)) {
        skippedOrg ??= p.orgName;
        continue;
      }
      // Apollo's search never returns emails (see EnrichmentProvider.searchPeople); a hit it
      // already flags as having no email would never yield one from a paid reveal either, so
      // skip it before spending a credit. `p.email` is checked too for a fake/future provider
      // that already has the email in hand from the cheap search.
      if (!p.hasEmail && !p.email) continue;
      const willPay = !p.email;
      if (willPay && remaining <= 0) break; // cap reached mid-run: stop revealing further people, but let the business finish
      const full: EnrichPerson | null = p.email ? p : await deps.providers.enrichment.enrichPerson(p.apolloId);
      if (!full) continue;
      if (willPay && full.email) remaining--;
      if (full.email) withEmail++;
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
    if (added === 0 && updated === 0 && skippedOrg) {
      // Every candidate that reached the org-name guard mismatched, and nothing else was added
      // or updated either: this is a targeting failure, not a "found nobody" success, so it gets
      // its own message and returns before validateEmails/recomputeContactQuality — matching how
      // the other early-return skip reasons above (excluded/not_found/recent) never touch those
      // either.
      //
      // lastEnrichedAt IS still set here (whole-branch review, L1), unlike those other skips:
      // without it the lead stays flagged as "needs enrichment" and a later bulk pass re-spends
      // the Organization Search credit on the same lead, only to hit the same mismatch again.
      // Force via Re-enrich still bypasses the recheckDays gate at the top of this function, so a
      // user who wants to retry a specific lead right away still can.
      await prisma.business.update({ where: { id: businessId }, data: { lastEnrichedAt: new Date() } });
      await log(`Enrichment skipped: Apollo matched a different company (${skippedOrg})`);
      return { added: 0, updated: 0, skipped: "org_mismatch" as const };
    }
    await validateEmails([businessId], deps);
    await recomputeContactQuality(businessId);
    await prisma.business.update({ where: { id: businessId }, data: { lastEnrichedAt: new Date() } });
    const found = people.length;
    if (found === 0) {
      // Search itself came back empty (no domain/name match at all) — distinct from "found
      // candidates but none had an email" below, and worth naming what was searched for since
      // there's nothing else (no titles) to show.
      await log(`Enriched via Apollo: no people found for ${domain ?? b.name}`);
    } else if (withEmail === 0) {
      // Search found candidates but none had (or yielded, on reveal) a verified email — worth
      // explaining which titles came back empty-handed rather than just "0 people" (the live bug
      // this task fixes: the best candidate used to never even be fetched).
      const titles = people.slice(0, 5).map((p) => p.title ?? "(no title)").join(", ");
      await log(`Enriched via Apollo: none of ${found} ${found === 1 ? "person" : "people"} found had an email (${titles})`);
    } else {
      await log(`Enriched via Apollo: ${withEmail} ${withEmail === 1 ? "person" : "people"} with a verified email out of ${found} found; ${contactRows} new contact${contactRows === 1 ? "" : "s"}, ${updated} updated`);
    }
    return { added, updated, skipped: null };
  } catch (e) {
    if (e instanceof BudgetExhaustedError) await log("Enrichment paused: Apollo daily budget exhausted");
    else if (e instanceof ProviderNotConfiguredError) await log("Enrichment skipped: Apollo API key is not configured");
    else if (e instanceof ProviderDisabledError) await log("Enrichment skipped: Apollo is disabled in Settings");
    else if (e instanceof ProviderPlanError) await log(`Enrichment unavailable: ${e.message} (${e.detail})`);
    else {
      // Whole-branch review, M3: everything else (429/5xx/network errors, etc.) used to leave no
      // activity row at all, so a lead that failed enrichment looked identical to one that was
      // never attempted. Apollo keys always travel in the "x-api-key" request header, never in a
      // URL or error message, so this can't leak key material in practice — but the redaction is
      // kept anyway as defense in depth against a future error message that happens to echo back
      // request state. Truncated to 200 chars so a huge provider error body can't bloat the log.
      const message = redactApiKeyLike(String((e as Error)?.message ?? e)).slice(0, 200);
      await log(`Enrichment failed: ${message}`);
    }
    throw e;
  }
}

/** Strips anything shaped like an "x-api-key" header value from a log message. Defense in depth
 * only — see the M3 comment at its call site for why this should never actually trigger. */
function redactApiKeyLike(message: string): string {
  return message.replace(/x-api-key[^\s]*/gi, "[redacted]");
}
