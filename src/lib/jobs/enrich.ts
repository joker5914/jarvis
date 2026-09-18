import { prisma } from "@/lib/db";
import { checkPause, upsertIgnoringConflict, type JobDeps } from "./shared";
import { validateEmails, recomputeContactQuality } from "./zipSearch";
import { ENRICH_CONFIG } from "@/lib/config/enrichment";
import { loadConfig, type RuntimeConfig } from "@/lib/config/runtime";
import { creditStatus } from "@/lib/enrichment/credits";
import { BudgetExhaustedError } from "@/lib/providers/budget";
import { CreditCapReachedError, ProviderNotConfiguredError, ProviderDisabledError, ProviderPlanError } from "@/lib/providers/errors";
import { orgNameMatches } from "@/lib/providers/apollo";
import { PLATFORM_EMAIL_DOMAINS } from "@/lib/extract/platformDomains";
import { stateNameFor } from "@/lib/geo/usStates";
import type { EnrichPerson, PeopleSearchQuery } from "@/lib/providers/types";

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

/**
 * Splits a formatted street address into its city and 2-letter state code, the way Google's
 * formatted_address strings lay them out ("street, city, ST zip[, country]"). Supersedes the
 * plain city-only cityFromAddress (kept below as a thin wrapper — other code and tests still use
 * it): the location cascade in searchPeople needs both to build Apollo's `person_locations[]`
 * filter (see src/lib/providers/apollo.ts and src/lib/geo/usStates.ts).
 */
export function regionFromAddress(addr: string | null): { city: string | null; state: string | null } {
  if (!addr) return { city: null, state: null };
  const parts = addr.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length <= 1) return { city: null, state: null };
  const last = parts[parts.length - 1];
  const isCountry = /^(usa|united states|us)$/i.test(last);
  const stateZipIdx = isCountry ? parts.length - 2 : parts.length - 1;
  const cityRaw = parts[stateZipIdx - 1];
  const city = cityRaw && !/\d/.test(cityRaw) ? cityRaw : null;
  const stateZip = parts[stateZipIdx] as string | undefined;
  const stateMatch = stateZip ? /^([A-Z]{2})\b/.exec(stateZip) : null;
  return { city, state: stateMatch ? stateMatch[1] : null };
}

export function cityFromAddress(addr: string | null): string | null {
  return regionFromAddress(addr).city;
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

/**
 * Builds the `PeopleSearchQuery` a free People Search or a paid enrich run sends to the
 * provider, from the business's own address/website and the owner's configured targeting
 * filters — the exact construction `runEnrich` used inline before Plan 10 Task 1, now shared
 * with `findCandidates` (src/lib/enrichment/candidates.ts) so the free "Find people" list and
 * the credited reveal always search the same way.
 */
export function buildPeopleSearchQuery(
  b: { websiteUrl: string | null; formattedAddress: string | null; name: string },
  cfg: RuntimeConfig,
): PeopleSearchQuery {
  const domain = domainFromUrl(b.websiteUrl);
  const { city, state } = regionFromAddress(b.formattedAddress);
  const metro = cfg.enrichment.metroLocation ?? null;
  return { domain, orgName: b.name, city, state, metro, titles: cfg.enrichment.preferredTitles, seniorities: cfg.enrichment.seniorities };
}

export async function runEnrich(
  businessId: string,
  ownerId: string,
  deps: JobDeps,
  opts: { force?: boolean; people?: number; apolloId?: string } = {},
): Promise<{ added: number; updated: number; skipped: "excluded" | "not_found" | "recent" | "org_mismatch" | "chain" | null }> {
  const b = await prisma.business.findFirst({ where: { id: businessId, ownerId } });
  if (!b) return { added: 0, updated: 0, skipped: "not_found" as const };
  if (b.exclusion !== "none") return { added: 0, updated: 0, skipped: "excluded" as const };
  const log = (message: string) => prisma.activityLog.create({ data: { ownerId, businessId, kind: "enriched", message } });
  // Revealing a candidate the rep explicitly chose (opts.apolloId) always bypasses the
  // recheckDays gate — `force` implied, per Plan 10 Task 1 — since the rep is asking for that
  // specific person right now, not for a routine re-scan.
  if (!opts.force && !opts.apolloId && b.lastEnrichedAt) {
    const daysSince = Math.floor((Date.now() - b.lastEnrichedAt.getTime()) / 86_400_000);
    if (daysSince < ENRICH_CONFIG.recheckDays) {
      await log(`Enrichment skipped: enriched ${daysSince} day(s) ago (use Re-enrich to refresh)`);
      return { added: 0, updated: 0, skipped: "recent" as const };
    }
  }
  const cfg = await loadConfig(ownerId);
  const maxPeople = Math.min(ENRICH_CONFIG.maxPeopleLimit, Math.max(1, opts.people ?? cfg.enrichment.maxPeople));
  // Reads the live Apollo balance off this run's own provider instance (deps.providers.enrichment),
  // not creditStatus's default getProviders().enrichment: the real ApolloEnrichmentProvider's
  // creditUsage() memo is module-scoped either way, but the fake provider's fakeCreditUsage is a
  // per-instance property, so a test priming *this* job's fake must have that instance actually
  // consulted rather than a fresh, unrelated one.
  const status = await creditStatus(ownerId, cfg, new Date(), deps.providers.enrichment);
  const { used, cap } = status;
  let remaining = status.remaining;
  if (remaining <= 0) {
    // Task 1 follow-up: when Apollo's own account balance (not the app's cap) is the binding
    // constraint — i.e. it's already at/below 0 regardless of what the app cap allows — say so
    // specifically; otherwise keep the existing app-cap wording. Both cases still throw the same
    // CreditCapReachedError (the numbers it carries describe the app's own cap either way).
    if (status.apollo && status.apollo.leftOver <= 0) {
      await log("Enrichment skipped: Apollo account is out of credits");
    } else {
      await log("Enrichment skipped: Apollo monthly credit cap reached");
    }
    throw new CreditCapReachedError(used, cap);
  }
  let added = 0;
  let updated = 0;
  let contactRows = 0;
  try {
    await checkPause(deps);
    // Plan 10 Task 1: a reveal the rep chose from the candidate list (POST /enrich { apolloId })
    // skips the search entirely (no candidate re-ranking, no org-mismatch guard, no suppression
    // filter — the rep already picked this specific person) and spends at most the one credit
    // this single enrichPerson() call costs, still subject to the credit cap checked above.
    if (opts.apolloId) {
      const full = await deps.providers.enrichment.enrichPerson(opts.apolloId);
      let revealAdded = 0;
      let revealUpdated = 0;
      let revealContactRows = 0;
      if (full) {
        const personName = full.name;
        const personTitle = full.title;
        const rows: { type: "email" | "linkedin"; value: string }[] = [];
        if (full.email) rows.push({ type: "email", value: full.email.toLowerCase() });
        if (full.linkedinUrl) {
          const li = canonicalLinkedin(full.linkedinUrl);
          if (li) rows.push({ type: "linkedin", value: li });
        }
        let personAdded = false;
        let personUpdated = false;
        for (const r of rows) {
          const existing = await prisma.contact.findUnique({ where: { businessId_type_value: { businessId, type: r.type, value: r.value } } });
          if (existing) {
            const data: { personName?: string; personTitle?: string; apolloId?: string } = {};
            if (!existing.personName && personName) data.personName = personName;
            if (!existing.personTitle && personTitle) data.personTitle = personTitle;
            if (!existing.apolloId) data.apolloId = full.apolloId;
            if (Object.keys(data).length > 0) {
              await prisma.contact.update({ where: { id: existing.id }, data });
              personUpdated = true;
            }
            continue;
          }
          await upsertIgnoringConflict(() =>
            prisma.contact.create({ data: { ownerId, businessId, type: r.type, value: r.value, source: "apollo", personName, personTitle, apolloId: full.apolloId } }),
          );
          personAdded = true;
          revealContactRows++;
        }
        if (personAdded) revealAdded++;
        if (personUpdated) revealUpdated++;
      }
      await validateEmails([businessId], deps);
      await recomputeContactQuality(businessId);
      await prisma.business.update({ where: { id: businessId }, data: { lastEnrichedAt: new Date() } });
      await log(
        `Enriched via Apollo: revealed ${full?.title ?? "person"} chosen by you; ${revealContactRows} new contact${revealContactRows === 1 ? "" : "s"}, ${revealUpdated} updated`,
      );
      return { added: revealAdded, updated: revealUpdated, skipped: null };
    }
    const query = buildPeopleSearchQuery(b, cfg);
    const { domain, city, state, metro } = query;
    const search = await deps.providers.enrichment.searchPeople(query, maxPeople);
    // Chain-headcount guard (Plan 9 Task 3): a domain with this many *decision-maker* hits in
    // Apollo (title/seniority-filtered by the same cfg.enrichment lists passed above — see the
    // ENRICH_CONFIG.chainHeadcountMin doc comment for why this isn't a raw employee count), at
    // any location, is a national chain, not an SMB prospect — reads search.totalAtDomain (the
    // *national* count from the cascade's unlocated first call), never search.totalFound (which
    // can be a much smaller scoped count, e.g. just a franchise's local city/metro page). Costs no
    // credit: this runs before the reveal loop below, and returns without touching lastEnrichedAt
    // so a later manual override (the "Restore as SMB" undo path) can still re-enrich. The
    // persisted reason string keeps the `apollo_headcount` name (not renamed to match the
    // "decision-makers" wording) since it's a stored, matched-on contract — see rescoreExclusions
    // and the PATCH route's clearChain branch.
    if (domain && search.totalAtDomain !== null && search.totalAtDomain >= cfg.enrichment.chainHeadcountMin) {
      const reason = `chain:apollo_headcount:${search.totalAtDomain}`;
      await prisma.business.update({
        where: { id: businessId },
        data: { exclusion: "enterprise", exclusionReasons: [...new Set([...b.exclusionReasons, reason])] },
      });
      await log(`Enrichment skipped: ${search.totalAtDomain} decision-makers at ${domain} in Apollo — not an SMB (marked as chain)`);
      return { added: 0, updated: 0, skipped: "chain" as const };
    }
    // Plan 10 Task 1: a person the rep already dismissed as "not the decision-maker" (Task 3's
    // suppression) never comes back on a later auto-enrich, even though the free search itself
    // still returns them — filtered out before ranking/counting so they don't occupy a reveal
    // slot or show up in totals.
    const suppressed = new Set(b.suppressedApolloIds);
    const people = search.people.filter((p) => !suppressed.has(p.apolloId));
    // Named for the activity-message suffixes below only — search.totalFound/totalAtDomain (the
    // free headcount signals) are consumed by the Task 3 chain guard, not by anything in this
    // function. Guarded per-branch (city && state, metro non-null, state) so a scope the query
    // couldn't actually have matched in (a malformed/partial result) never renders as
    // "(matched in null, null)" — by construction searchPeople only ever sets a scope when the
    // corresponding location input was present, but this stays defensive rather than trusting that.
    // L1 (whole-branch review): when the cascade actually ran (totalAtDomain > searchPageSize —
    // the single-location-SMB short-circuit above only ever returns scope "any" for totalAtDomain
    // <= searchPageSize, so this can't misfire on that case) but every located scope came back
    // empty, searchPeople falls back to the unlocated page and reports scope "any" again — which
    // otherwise looks identical to "no location info was ever available to search with." Only
    // worth calling out when a located input actually existed to try (city+state, or metro), so a
    // business with neither doesn't get a misleading "searched nationally" note about a cascade
    // that never had anywhere local to look.
    const hadLocatedInput = (city !== null && state !== null) || metro !== null;
    const scopeSuffix =
      search.scope === "city" && city && state
        ? ` (matched in ${city}, ${state})`
        : search.scope === "metro" && metro
          ? ` (matched in ${metro})`
          : search.scope === "state" && state
            ? ` (matched in ${stateNameFor(state)})`
            : search.scope === "any" && search.totalAtDomain !== null && search.totalAtDomain > ENRICH_CONFIG.searchPageSize && hadLocatedInput
              ? " (no local match; searched nationally)"
              : "";
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
    // Bound the run by *reveals* (the calls that can cost a credit), not by candidates examined:
    // rejecting a candidate on the free search data (wrong company, no email) costs nothing, so
    // walk the whole ranked page until `maxPeople` reveals have been made. Otherwise a no-email
    // Owner at rank 0 would end a maxPeople=1 run with nothing while an emailed Manager sits at
    // rank 1 in a page we already fetched for free.
    let reveals = 0;
    let checked = 0;
    for (const p of people) {
      if (reveals >= maxPeople) break;
      await checkPause(deps);
      checked++;
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
      reveals++;
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
          const data: { personName?: string; personTitle?: string; apolloId?: string } = {};
          if (!existing.personName && personName) data.personName = personName;
          if (!existing.personTitle && personTitle) data.personTitle = personTitle;
          // Plan 10 Task 1: backfill apolloId on an existing row (e.g. one first created from the
          // website before Apollo confirmed the same email) so a later "not the decision-maker"
          // suppression (Task 3) can find and remove it.
          if (!existing.apolloId) data.apolloId = p.apolloId;
          if (Object.keys(data).length > 0) {
            await prisma.contact.update({ where: { id: existing.id }, data });
            personUpdated = true;
          }
          continue;
        }
        await upsertIgnoringConflict(() =>
          prisma.contact.create({ data: { ownerId, businessId, type: r.type, value: r.value, source: "apollo", personName, personTitle, apolloId: p.apolloId } }),
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
      // Report the candidates actually examined (the loop above may stop early at the credit
      // cap), never titles of people that were never looked at.
      const examined = people.slice(0, checked);
      const titles = examined.slice(0, 5).map((p) => p.title ?? "(no title)").join(", ");
      const noun = (n: number) => (n === 1 ? "person" : "people");
      await log(
        (checked < found
          ? `Enriched via Apollo: none of the ${checked} ${noun(checked)} checked (of ${found} found) had an email (${titles})`
          : `Enriched via Apollo: none of ${found} ${noun(found)} found had an email (${titles})`) + scopeSuffix,
      );
    } else {
      await log(`Enriched via Apollo: ${withEmail} ${withEmail === 1 ? "person" : "people"} with a verified email out of ${found} found; ${contactRows} new contact${contactRows === 1 ? "" : "s"}, ${updated} updated${scopeSuffix}`);
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
 * only — see the M3 comment at its call site for why this should never actually trigger. Exported
 * (fix round, review N3) so scripts/chain-sweep.ts's per-business error logging reuses the exact
 * same redaction instead of a second hand-copy of the pattern. */
export function redactApiKeyLike(message: string): string {
  return message.replace(/x-api-key[^\s]*/gi, "[redacted]");
}
