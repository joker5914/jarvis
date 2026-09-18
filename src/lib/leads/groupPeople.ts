import type { PersonLike } from "@/lib/leads/pocConfidence";

// apolloId (Plan 10 Task 2): links an Apollo-sourced contact row back to the candidate it was
// revealed from, so PeopleSection can tell an already-revealed candidate apart from one still
// waiting on a reveal.
export type GroupableContact = {
  type: string;
  value: string;
  personName: string | null;
  personTitle: string | null;
  source: string;
  apolloId: string | null;
};

// apolloId on the grouped row (Plan 10 Task 3): carried from whichever contact row is first seen
// for that name, same as `source`, so PeopleSection can scope "Not the decision-maker" to an
// actually-revealed Apollo person (source "apollo" AND an apolloId — a manual row can share
// `source: "manual"` but never has one).
//
// Fix round (Task 4 re-review): this type used to live in PeopleSection.tsx, and this file
// imported it from there — a lib module reaching into a component module for a type it is itself
// responsible for producing. Moved here so the dependency runs the ordinary direction:
// PeopleSection now imports `Person` from this module instead.
export type Person = PersonLike & { key: string; email: string | null; linkedin: string | null; apolloId: string | null };

/** Groups contacts that carry a `personName` (Apollo-enriched) into one row per person,
 * pairing that person's email and LinkedIn contact rows together. `isPrimary` (Plan 10 Task 2)
 * marks the row whose name matches `Business.primaryPerson` — the manual pointer a rep sets by
 * hand. `apolloId` (Task 3) is carried from whichever contact row is first seen for that name —
 * used by PeopleSection to scope "Not the decision-maker" to actually-revealed Apollo people.
 *
 * Task 3 amendment (fix round for 3eed43d): a hand-added primary contact submitted with only a
 * name and title (no email/phone) creates no Contact row at all — POST /people's whole point is
 * that field knowledge doesn't need a database hit to count — so `primaryPerson` can point at a
 * name no contact row carries. When that happens, synthesize a bare row for it (source
 * "manual", `primaryPersonTitle` if one was given, no email/linkedin known) so the rep still sees
 * their pick lead the People section instead of it silently vanishing.
 *
 * The primary contact always leads the section (Task 3): a stable sort moves the `isPrimary` row
 * to the front without disturbing the relative order of everyone else.
 *
 * Fix round (review): extracted out of `LeadDetail.tsx` into this pure, dependency-free module —
 * no React, no fetch — so it can be unit-tested directly instead of only indirectly through the
 * component.
 */
export function groupPeople(contacts: GroupableContact[], primaryPerson: string | null, primaryPersonTitle: string | null): Person[] {
  const byName = new Map<string, Person>();
  for (const c of contacts) {
    if (!c.personName) continue;
    let p = byName.get(c.personName);
    if (!p) {
      p = {
        key: c.personName,
        name: c.personName,
        title: c.personTitle,
        email: null,
        linkedin: null,
        source: c.source,
        apolloId: c.apolloId,
        isPrimary: c.personName === primaryPerson,
      };
      byName.set(c.personName, p);
    }
    if (!p.title && c.personTitle) p.title = c.personTitle;
    if (c.type === "email" && !p.email) p.email = c.value;
    if (c.type === "linkedin" && !p.linkedin) p.linkedin = c.value;
  }
  if (primaryPerson && !byName.has(primaryPerson)) {
    byName.set(primaryPerson, {
      key: primaryPerson,
      name: primaryPerson,
      title: primaryPersonTitle,
      email: null,
      linkedin: null,
      source: "manual",
      apolloId: null,
      isPrimary: true,
    });
  }
  const people = [...byName.values()];
  people.sort((a, b) => (a.isPrimary === b.isPrimary ? 0 : a.isPrimary ? -1 : 1));
  return people;
}
