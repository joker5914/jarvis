import { describe, it, expect } from "vitest";
import { pocConfidence, type PersonLike } from "@/lib/leads/pocConfidence";
import type { CandidateSet } from "@/lib/enrichment/candidates";

function person(over: Partial<PersonLike> = {}): PersonLike {
  return { name: "Someone", title: null, source: "apollo", isPrimary: false, ...over };
}

function candidateSet(over: Partial<CandidateSet> = {}): CandidateSet {
  return { fetchedAt: new Date().toISOString(), scope: "any", totalAtDomain: null, candidates: [], ...over };
}

// pocConfidence(people, candidates, primaryPerson) — primaryPerson defaults to null so most
// cases below don't have to spell it out.
function conf(people: PersonLike[], candidates: CandidateSet | null, primaryPerson: string | null = null) {
  return pocConfidence(people, candidates, primaryPerson);
}

describe("pocConfidence", () => {
  it("a manual primary contact wins regardless of title, from the primaryPerson argument", () => {
    const people = [person({ name: "Albert", title: null, source: "manual", isPrimary: true })];
    expect(conf(people, null, "Albert")).toEqual({ level: "primary", label: "Primary contact set by you" });
  });

  it("a manual primary takes precedence over an Apollo owner also present", () => {
    const people = [
      person({ name: "Addison Neel", title: "Owner", isPrimary: false }),
      person({ name: "Albert", title: null, source: "manual", isPrimary: true }),
    ];
    expect(conf(people, null, "Albert")).toEqual({ level: "primary", label: "Primary contact set by you" });
  });

  // Fix round for 3eed43d (Task 3 amendment): a hand-added primary contact submitted with only
  // a name and title creates no Contact row, so no row in `people` can ever carry it — the
  // `primaryPerson` argument alone must still be enough to read as `primary`.
  it("primaryPerson alone is enough, even when no person row carries that name", () => {
    expect(conf([], null, "Albert")).toEqual({ level: "primary", label: "Primary contact set by you" });
    const people = [person({ name: "Addison Neel", title: "Owner" })];
    expect(conf(people, null, "Albert")).toEqual({ level: "primary", label: "Primary contact set by you" });
  });

  it("Owner is a decision-maker", () => {
    const people = [person({ title: "Owner" })];
    expect(conf(people, null)).toEqual({ level: "decision_maker", label: "Decision-maker" });
  });

  it("Founder, Co-founder, President, CEO, Chief Executive Officer, Principal, Proprietor, Partner and Owner/Operator are all decision-makers", () => {
    for (const title of ["Founder", "Co-founder", "President", "CEO", "Chief Executive Officer", "Principal", "Proprietor", "Partner", "Owner/Operator"]) {
      expect(conf([person({ title })], null).level).toBe("decision_maker");
    }
  });

  it("Store Manager is a manager, best-available label names the title", () => {
    const people = [person({ title: "Store Manager" })];
    expect(conf(people, null)).toEqual({ level: "manager", label: "Best available: Store Manager — no owner listed in Apollo" });
  });

  it("Production/Operations Manager is a manager", () => {
    const people = [person({ title: "Production/Operations Manager" })];
    expect(conf(people, null)).toEqual({
      level: "manager",
      label: "Best available: Production/Operations Manager — no owner listed in Apollo",
    });
  });

  it("Director and Head of ... titles are managers too", () => {
    for (const title of ["Director of Operations", "Head of Sales"]) {
      expect(conf([person({ title })], null).level).toBe("manager");
    }
  });

  it("Managing Director is a manager (word-bounded 'Director' matches, unbounded 'Managing' does not)", () => {
    expect(conf([person({ title: "Managing Director" })], null).level).toBe("manager");
  });

  it("Barista Manager is a manager", () => {
    expect(conf([person({ title: "Barista Manager" })], null).level).toBe("manager");
  });

  it("Managing Barista is staff, not a manager (no word-bounded manager/director/operations hit)", () => {
    expect(conf([person({ title: "Managing Barista" })], null)).toEqual({ level: "staff", label: "Staff contact — no decision-maker listed in Apollo" });
  });

  it("Barista is staff", () => {
    const people = [person({ title: "Barista" })];
    expect(conf(people, null)).toEqual({ level: "staff", label: "Staff contact — no decision-maker listed in Apollo" });
  });

  it("a revealed person with no title at all is staff", () => {
    const people = [person({ title: null })];
    expect(conf(people, null)).toEqual({ level: "staff", label: "Staff contact — no decision-maker listed in Apollo" });
  });

  it("a decision-maker title wins over a manager title when both are present", () => {
    const people = [person({ name: "Lee", title: "General Manager" }), person({ name: "Maria", title: "Owner" })];
    expect(conf(people, null).level).toBe("decision_maker");
  });

  // Fix round for 3eed43d: word-bounding DECISION_MAKER_RE fixes a false positive ("partner"
  // used to match inside "Partnerships"), and the explicit exclude list catches support-role
  // titles that otherwise contain a decision-maker word ("assistant", "coordinator", "to the").
  it("a support-role title is excluded from decision-maker even when it contains a decision-maker word", () => {
    expect(conf([person({ title: "Owner's assistant" })], null)).toEqual({ level: "staff", label: "Staff contact — no decision-maker listed in Apollo" });
    expect(conf([person({ title: "Assistant to the Owner" })], null)).toEqual({ level: "staff", label: "Staff contact — no decision-maker listed in Apollo" });
    expect(conf([person({ title: "Partnerships Coordinator" })], null)).toEqual({ level: "staff", label: "Staff contact — no decision-maker listed in Apollo" });
  });

  it("nobody revealed and candidates never searched: Not searched yet", () => {
    expect(conf([], null)).toEqual({ level: "none", label: "Not searched yet" });
  });

  it("nobody revealed and candidates came back empty: No people found in Apollo", () => {
    expect(conf([], candidateSet({ candidates: [] }))).toEqual({ level: "none", label: "No people found in Apollo" });
  });

  it("nobody revealed but candidates exist to choose from: Candidates found — choose who to reveal", () => {
    const set = candidateSet({
      candidates: [{ apolloId: "fake-1", firstName: "Lee", title: "General Manager", hasEmail: false, orgName: null, rank: 0 }],
    });
    expect(conf([], set)).toEqual({ level: "none", label: "Candidates found — choose who to reveal" });
  });
});
