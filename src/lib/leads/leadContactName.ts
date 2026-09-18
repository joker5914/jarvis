export type ContactNameSource = {
  primaryPerson: string | null;
  contacts: { personName: string | null }[];
};

/** The lead's likely point of contact, for the Leads table's Contact column (Plan 10 Task 3):
 * `primaryPerson` — the rep's own pick, whether hand-typed or chosen from an Apollo reveal —
 * leads when set; otherwise the first named contact row (Apollo-enriched or manual), if any.
 *
 * Fix round (review): extracted out of `LeadsTable.tsx` into this pure module so it's
 * unit-testable without constructing a full `LeadRow`/rendering the table. */
export function leadContactName(b: ContactNameSource): string | null {
  if (b.primaryPerson) return b.primaryPerson;
  return b.contacts.find((c) => c.personName)?.personName ?? null;
}
