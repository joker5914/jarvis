import type { CandidateSet } from "@/lib/enrichment/candidates";

export type PocLevel = "primary" | "decision_maker" | "manager" | "staff" | "none";
export type PocConfidence = { level: PocLevel; label: string };

/** The shape `pocConfidence` needs from a grouped People row (LeadDetail's `groupPeople`
 * output). `source` travels with the type for parity with the plan's interface and for callers
 * that want it (e.g. rendering), but this function itself doesn't filter on it: a "revealed
 * person" here just means any row the People section already knows about (Apollo-revealed today;
 * a Task 3 manual addition reads the same way — its title, if any, still tells us whether it
 * looks like a decision-maker). `isPrimary` likewise travels for the caller's own rendering (a
 * "Primary" badge) — `pocConfidence` itself decides the `primary` level from the `primaryPerson`
 * argument below, not from scanning this flag, since a hand-added primary contact with only a
 * name and no email/phone/title creates no Contact row at all (fix round for 3eed43d /
 * Task 3 amendment) and so would never appear in `people` for a row-scan to find. */
export type PersonLike = { name: string; title: string | null; source: string; isPrimary: boolean };

// Word-bounded (fix round for 3eed43d): an unbounded `partner` used to match inside
// "Partnerships Coordinator" (itself just a substring hit, no word boundary at the "r"/"s"
// join), misreading a coordinator as a decision-maker. `chief` and the explicit
// `owner/operator` compound are additions per the same fix round.
const DECISION_MAKER_RE = /\b(owner|owner\/operator|founder|co-founder|president|ceo|chief|principal|proprietor|partner)\b/i;
// A title that otherwise matches DECISION_MAKER_RE but names a support role reporting to the
// decision-maker — "Owner's assistant", "Assistant to the Owner", "Partnerships Coordinator" —
// is not itself the decision-maker; excluded here so it falls through to the manager/staff rules
// below instead.
const DECISION_MAKER_EXCLUDE_RE = /\b(assistant|coordinator|to the)\b/i;
const MANAGER_RE = /\b(manager|director|head of|operations)\b/i;

/**
 * Derives a plain-language read on how confident the rep should be in the lead's point of
 * contact, from what's already known — never a stored value, so it's always consistent with the
 * current People rows, candidate list, and primary-contact pointer. Rules run in order; the
 * first match wins.
 */
export function pocConfidence(people: PersonLike[], candidates: CandidateSet | null, primaryPerson: string | null): PocConfidence {
  if (primaryPerson) return { level: "primary", label: "Primary contact set by you" };

  const decisionMaker = people.find((p) => p.title && DECISION_MAKER_RE.test(p.title) && !DECISION_MAKER_EXCLUDE_RE.test(p.title));
  if (decisionMaker) return { level: "decision_maker", label: "Decision-maker" };

  const manager = people.find((p) => p.title && MANAGER_RE.test(p.title));
  if (manager) return { level: "manager", label: `Best available: ${manager.title} — no owner listed in Apollo` };

  if (people.length > 0) return { level: "staff", label: "Staff contact — no decision-maker listed in Apollo" };

  if (candidates === null) return { level: "none", label: "Not searched yet" };
  if (candidates.candidates.length === 0) return { level: "none", label: "No people found in Apollo" };
  return { level: "none", label: "Candidates found — choose who to reveal" };
}
