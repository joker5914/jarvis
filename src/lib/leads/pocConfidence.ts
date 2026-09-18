import type { CandidateSet } from "@/lib/enrichment/candidates";

export type PocLevel = "primary" | "decision_maker" | "manager" | "staff" | "none";
export type PocConfidence = { level: PocLevel; label: string };

/** The shape `pocConfidence` needs from a grouped People row (LeadDetail's `groupPeople`
 * output plus an `isPrimary` flag the caller computes from `Business.primaryPerson`). `source`
 * travels with the type for parity with the plan's interface and for callers that want it, but
 * this function itself doesn't filter on it: a "revealed person" here just means any row the
 * People section already knows about (Apollo-revealed today; a Task 3 manual addition that
 * isn't the primary contact reads the same way — its title, if any, still tells us whether it
 * looks like a decision-maker). */
export type PersonLike = { name: string; title: string | null; source: string; isPrimary: boolean };

const DECISION_MAKER_RE = /owner|founder|co-founder|president|ceo|principal|proprietor|partner/i;
const MANAGER_RE = /manager|director|head of|operations/i;

/**
 * Derives a plain-language read on how confident the rep should be in the lead's point of
 * contact, from what's already known — never a stored value, so it's always consistent with the
 * current People rows and candidate list. Rules run in order; the first match wins.
 */
export function pocConfidence(people: PersonLike[], candidates: CandidateSet | null): PocConfidence {
  const primary = people.find((p) => p.isPrimary);
  if (primary) return { level: "primary", label: "Primary contact set by you" };

  const decisionMaker = people.find((p) => p.title && DECISION_MAKER_RE.test(p.title));
  if (decisionMaker) return { level: "decision_maker", label: "Decision-maker" };

  const manager = people.find((p) => p.title && MANAGER_RE.test(p.title));
  if (manager) return { level: "manager", label: `Best available: ${manager.title} — no owner listed in Apollo` };

  if (people.length > 0) return { level: "staff", label: "Staff contact — no decision-maker listed in Apollo" };

  if (candidates === null) return { level: "none", label: "Not searched yet" };
  if (candidates.candidates.length === 0) return { level: "none", label: "No people found in Apollo" };
  return { level: "none", label: "Candidates found — choose who to reveal" };
}
