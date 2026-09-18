import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { loadConfig } from "@/lib/config/runtime";
import { ENRICH_CONFIG } from "@/lib/config/enrichment";
import { buildPeopleSearchQuery } from "@/lib/jobs/enrich";
import type { JobDeps } from "@/lib/jobs/shared";
import { orgNameMatches } from "@/lib/providers/apollo";
import type { PeopleSearchScope } from "@/lib/providers/types";

/** One person from a free Apollo People Search result, before any credit has been spent on
 * them: only what Apollo's search response already shows for free — a first name and a title,
 * never a last name or an email address (those only resolve on a paid reveal, via
 * `runEnrich`'s `apolloId` option). `rank` is a dense 0-based index (0 = best match) assigned
 * *after* the org-mismatch and suppression filters below run — it preserves the provider's own
 * relative ranking order among the survivors, but is renumbered contiguously rather than
 * carrying over each candidate's original position in the unfiltered page (fix round, R9: the
 * previous wording implied the latter), so a picker can render candidates in rank order without
 * re-deriving anything or seeing gaps where a mismatched/suppressed candidate was dropped. */
export type Candidate = {
  apolloId: string;
  firstName: string | null;
  title: string | null;
  hasEmail: boolean;
  orgName: string | null;
  rank: number;
  /** Whole-branch review L2: set (ISO timestamp) by `runEnrich` the moment this candidate is
   * actually revealed — whether or not that reveal produced a Contact row (a person with no email
   * and no LinkedIn on file still counts as "already looked at," so the picker shouldn't offer to
   * spend another credit on them). `PeopleSection` treats a candidate as revealed when either this
   * is set OR a Contact row carries a matching `apolloId` (the common case, when the reveal did
   * produce a row) — the two can disagree exactly in that no-contact-row case. Null until then. */
  revealedAt: string | null;
};

/** The stored, free candidate list for one business — persisted on `Business.candidates` /
 * `candidatesAt` so the rep can browse it (and pick who to reveal) without re-querying Apollo,
 * and so `pocConfidence` (Task 2) can tell "nobody searched yet" apart from "searched, found
 * nobody." */
export type CandidateSet = {
  fetchedAt: string;
  scope: PeopleSearchScope;
  totalAtDomain: number | null;
  candidates: Candidate[];
};

/** Whole-branch review L2: returns a copy of `set` with the candidate matching `apolloId`
 * stamped `revealedAt` — a no-op copy (still returns a new object, for consistent update
 * semantics at the call site) when no candidate in the set has that id, e.g. a reveal-by-id for a
 * candidate that was never in the free search results (an id typed some other way, or a set
 * fetched before this exact person showed up). Pure and dependency-free so it's trivially unit
 * testable and safe to call from `runEnrich` (src/lib/jobs/enrich.ts) without pulling any prisma
 * code into this module. */
export function markCandidateRevealed(set: CandidateSet, apolloId: string, revealedAt: string): CandidateSet {
  return { ...set, candidates: set.candidates.map((c) => (c.apolloId === apolloId ? { ...c, revealedAt } : c)) };
}

/**
 * Free "Find people" step (Plan 10 Task 1): runs the same Apollo People Search `runEnrich` uses
 * for its auto-reveal loop (via the shared `buildPeopleSearchQuery`), but never reveals anyone —
 * People Search itself costs no Apollo credits, only counts toward the app's own daily call
 * budget (`withBudget("apollo", …)`, applied inside `searchPeople`). Mirrors `runEnrich`'s
 * no-domain org-mismatch guard (`orgNameMatches`) exactly, so a shared booking/ordering
 * platform's own staff never shows up as a candidate for a lead whose website is just a page
 * hosted on that platform; when every candidate mismatches, this returns an empty set rather
 * than throwing or logging (there is nothing credited to explain away here). Also drops any
 * `Business.suppressedApolloIds` the rep already rejected as "not the decision-maker." Persists
 * the resulting set on the business and returns it — never touches `Contact` rows or
 * `lastEnrichedAt`, since nothing was revealed.
 */
export async function findCandidates(businessId: string, ownerId: string, deps: JobDeps): Promise<CandidateSet> {
  const b = await prisma.business.findFirstOrThrow({ where: { id: businessId, ownerId } });
  const cfg = await loadConfig(ownerId);
  const query = buildPeopleSearchQuery(b, cfg);
  const search = await deps.providers.enrichment.searchPeople(query, ENRICH_CONFIG.searchPageSize);
  let people = search.people;
  // Same guard as runEnrich's auto-reveal loop, and for the same reason: only meaningful when the
  // search wasn't already scoped by the lead's own domain (see orgNameMatches's callers in
  // src/lib/jobs/enrich.ts for the full rationale).
  if (!query.domain) {
    people = people.filter((p) => !p.orgName || orgNameMatches(p.orgName, b.name));
  }
  const suppressed = new Set(b.suppressedApolloIds);
  people = people.filter((p) => !suppressed.has(p.apolloId));
  const candidates: Candidate[] = people.map((p, i) => ({
    apolloId: p.apolloId,
    firstName: p.firstName,
    title: p.title,
    hasEmail: p.hasEmail,
    orgName: p.orgName,
    rank: i,
    revealedAt: null,
  }));
  const set: CandidateSet = { fetchedAt: new Date().toISOString(), scope: search.scope, totalAtDomain: search.totalAtDomain, candidates };
  await prisma.business.update({
    where: { id: businessId },
    data: {
      candidates: set as unknown as Prisma.InputJsonValue,
      candidatesAt: new Date(),
      // Whole-branch review H1: only ever set from a *resolved* domain — `?? undefined` leaves
      // the column untouched (not cleared to null) on a call that didn't need Organization Search
      // (had a domain already, or one is already memoized) or whose org search found nothing.
      ...(search.resolvedDomain ? { apolloOrgDomain: search.resolvedDomain } : {}),
    },
  });
  // Whole-branch review H1: Organization Search is the one branch of a free "Find people" call
  // that actually costs a real Apollo credit (see PeopleSearchResult.orgSearchCredits's doc
  // comment) — logged here, not inside the provider layer, since providers don't write to the
  // database themselves.
  for (let i = 0; i < (search.orgSearchCredits ?? 0); i++) {
    await prisma.activityLog.create({
      data: { ownerId, businessId, kind: "credit_spent", message: "Apollo credit: organization search" },
    });
  }
  return set;
}
