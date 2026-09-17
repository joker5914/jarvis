// Shared classifier for stored email `Contact.value`s whose local part carries a phone-number
// or zip/digit-run fragment glued on from adjacent page text with no separator (e.g.
// "77581info@eatportara.com" from a zip code, "-229-4384chefstevehaug@…" from a phone number,
// "77584phone832-295-3350emailamericanailspearland@…" from both). These are syntactically valid
// emails — `normalizeEmail` alone can't tell they're wrong — so `scripts/cleanup-invalid-emails.ts`
// uses this in addition to `normalizeEmail` to flag them for deletion. Extracted out of the
// script (rather than kept inline) so it's unit-testable on its own.
//
// A local part is glued when either:
//   - it starts with a phone/zip fragment (the original leading-fragment rule), or
//   - it contains a `\d{3}-\d{4}` phone fragment anywhere, or
//   - it contains a run of 5+ digits immediately followed by a letter anywhere.
const LEADING_FRAGMENT_RE = /^(-?\d{3}-\d{4}|\d{5})[a-z]/i;
const PHONE_FRAGMENT_ANYWHERE_RE = /\d{3}-\d{4}/;
const DIGIT_RUN_BEFORE_LETTER_RE = /\d{5,}[a-z]/i;

export function isGluedLocalPart(local: string): boolean {
  return LEADING_FRAGMENT_RE.test(local) || PHONE_FRAGMENT_ANYWHERE_RE.test(local) || DIGIT_RUN_BEFORE_LETTER_RE.test(local);
}

/** Convenience for a full email address: applies `isGluedLocalPart` to the part before the `@`. */
export function isGluedEmail(email: string): boolean {
  return isGluedLocalPart(email.split("@")[0] ?? "");
}
