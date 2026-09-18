import { describe, it, expect } from "vitest";
import { groupPeople, type GroupableContact } from "@/lib/leads/groupPeople";

function contact(over: Partial<GroupableContact> = {}): GroupableContact {
  return { type: "email", value: "x@example.com", personName: "Someone", personTitle: null, source: "apollo", apolloId: "fake-1", ...over };
}

describe("groupPeople", () => {
  it("pairs a person's email and linkedin rows into one row", () => {
    const contacts: GroupableContact[] = [
      contact({ type: "email", value: "lee@example.com", personName: "Lee", personTitle: "Manager" }),
      contact({ type: "linkedin", value: "https://www.linkedin.com/in/lee", personName: "Lee", personTitle: null }),
    ];
    const people = groupPeople(contacts, null, null);
    expect(people).toHaveLength(1);
    expect(people[0]).toMatchObject({ name: "Lee", title: "Manager", email: "lee@example.com", linkedin: "https://www.linkedin.com/in/lee" });
  });

  it("ignores contact rows with no personName", () => {
    const contacts: GroupableContact[] = [contact({ personName: null })];
    expect(groupPeople(contacts, null, null)).toHaveLength(0);
  });

  it("marks isPrimary on the row matching primaryPerson", () => {
    const contacts: GroupableContact[] = [contact({ personName: "Lee" }), contact({ personName: "Maria" })];
    const people = groupPeople(contacts, "Maria", null);
    expect(people.find((p) => p.name === "Maria")?.isPrimary).toBe(true);
    expect(people.find((p) => p.name === "Lee")?.isPrimary).toBe(false);
  });

  // Plan 10 Task 3: the primary contact always leads the section, regardless of contact insertion
  // order — a stable sort, not a re-derivation of order.
  it("sorts the primary row first, preserving relative order of everyone else", () => {
    const contacts: GroupableContact[] = [
      contact({ personName: "Alice" }),
      contact({ personName: "Bob" }),
      contact({ personName: "Carol" }),
    ];
    const people = groupPeople(contacts, "Carol", null);
    expect(people.map((p) => p.name)).toEqual(["Carol", "Alice", "Bob"]);
  });

  it("does not disturb order when nobody is primary", () => {
    const contacts: GroupableContact[] = [contact({ personName: "Alice" }), contact({ personName: "Bob" })];
    const people = groupPeople(contacts, null, null);
    expect(people.map((p) => p.name)).toEqual(["Alice", "Bob"]);
  });

  // Task 3 amendment: a hand-added primary with only a name+title creates no Contact row —
  // groupPeople synthesizes a bare row for it instead of losing the pick.
  it("synthesizes a bare row for a primaryPerson with no matching Contact row, using primaryPersonTitle", () => {
    const people = groupPeople([], "Albert", "Owner");
    expect(people).toHaveLength(1);
    expect(people[0]).toMatchObject({ name: "Albert", title: "Owner", email: null, linkedin: null, source: "manual", apolloId: null, isPrimary: true });
  });

  it("does not duplicate the primary row when a real Contact row already carries that name", () => {
    const contacts: GroupableContact[] = [contact({ personName: "Albert", personTitle: "Owner" })];
    const people = groupPeople(contacts, "Albert", "Some Other Title");
    expect(people).toHaveLength(1);
    // The real Contact row's own title wins — primaryPersonTitle is only a fallback for the
    // no-Contact-row case.
    expect(people[0].title).toBe("Owner");
  });

  it("carries apolloId from the contact row, for scoping \"not the decision-maker\" to Apollo-sourced people", () => {
    const contacts: GroupableContact[] = [contact({ personName: "Lee", source: "apollo", apolloId: "fake-lee" })];
    const people = groupPeople(contacts, null, null);
    expect(people[0].apolloId).toBe("fake-lee");
    expect(people[0].source).toBe("apollo");
  });

  it("a manual row has no apolloId", () => {
    const contacts: GroupableContact[] = [contact({ personName: "Albert", source: "manual", apolloId: null })];
    const people = groupPeople(contacts, null, null);
    expect(people[0].apolloId).toBeNull();
  });
});
