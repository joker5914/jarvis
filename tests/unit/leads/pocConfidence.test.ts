import { describe, it, expect } from "vitest";
import { pocConfidence, type PersonLike } from "@/lib/leads/pocConfidence";
import type { CandidateSet } from "@/lib/enrichment/candidates";

function person(over: Partial<PersonLike> = {}): PersonLike {
  return { name: "Someone", title: null, source: "apollo", isPrimary: false, ...over };
}

function candidateSet(over: Partial<CandidateSet> = {}): CandidateSet {
  return { fetchedAt: new Date().toISOString(), scope: "any", totalAtDomain: null, candidates: [], ...over };
}

describe("pocConfidence", () => {
  it("a manual primary contact wins regardless of title", () => {
    const people = [person({ name: "Albert", title: null, source: "manual", isPrimary: true })];
    expect(pocConfidence(people, null)).toEqual({ level: "primary", label: "Primary contact set by you" });
  });

  it("a manual primary takes precedence over an Apollo owner also present", () => {
    const people = [
      person({ name: "Addison Neel", title: "Owner", isPrimary: false }),
      person({ name: "Albert", title: null, source: "manual", isPrimary: true }),
    ];
    expect(pocConfidence(people, null)).toEqual({ level: "primary", label: "Primary contact set by you" });
  });

  it("Owner is a decision-maker", () => {
    const people = [person({ title: "Owner" })];
    expect(pocConfidence(people, null)).toEqual({ level: "decision_maker", label: "Decision-maker" });
  });

  it("Founder, Co-founder, President, CEO, Principal, Proprietor and Partner are all decision-makers", () => {
    for (const title of ["Founder", "Co-founder", "President", "CEO", "Principal", "Proprietor", "Partner"]) {
      expect(pocConfidence([person({ title })], null).level).toBe("decision_maker");
    }
  });

  it("Store Manager is a manager, best-available label names the title", () => {
    const people = [person({ title: "Store Manager" })];
    expect(pocConfidence(people, null)).toEqual({ level: "manager", label: "Best available: Store Manager — no owner listed in Apollo" });
  });

  it("Production/Operations Manager is a manager", () => {
    const people = [person({ title: "Production/Operations Manager" })];
    expect(pocConfidence(people, null)).toEqual({
      level: "manager",
      label: "Best available: Production/Operations Manager — no owner listed in Apollo",
    });
  });

  it("Director and Head of ... titles are managers too", () => {
    for (const title of ["Director of Operations", "Head of Sales"]) {
      expect(pocConfidence([person({ title })], null).level).toBe("manager");
    }
  });

  it("Barista is staff", () => {
    const people = [person({ title: "Barista" })];
    expect(pocConfidence(people, null)).toEqual({ level: "staff", label: "Staff contact — no decision-maker listed in Apollo" });
  });

  it("a revealed person with no title at all is staff", () => {
    const people = [person({ title: null })];
    expect(pocConfidence(people, null)).toEqual({ level: "staff", label: "Staff contact — no decision-maker listed in Apollo" });
  });

  it("a decision-maker title wins over a manager title when both are present", () => {
    const people = [person({ name: "Lee", title: "General Manager" }), person({ name: "Maria", title: "Owner" })];
    expect(pocConfidence(people, null).level).toBe("decision_maker");
  });

  it("nobody revealed and candidates never searched: Not searched yet", () => {
    expect(pocConfidence([], null)).toEqual({ level: "none", label: "Not searched yet" });
  });

  it("nobody revealed and candidates came back empty: No people found in Apollo", () => {
    expect(pocConfidence([], candidateSet({ candidates: [] }))).toEqual({ level: "none", label: "No people found in Apollo" });
  });

  it("nobody revealed but candidates exist to choose from: Candidates found — choose who to reveal", () => {
    const set = candidateSet({
      candidates: [{ apolloId: "fake-1", firstName: "Lee", title: "General Manager", hasEmail: false, orgName: null, rank: 0 }],
    });
    expect(pocConfidence([], set)).toEqual({ level: "none", label: "Candidates found — choose who to reveal" });
  });
});
