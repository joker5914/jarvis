import { regionFromAddress } from "@/lib/extract/address";

export type AssistLinks = {
  linkedinPeople: string;
  facebookPages: string;
  googleOwner: string;
  tel: string | null;
  /** Whole-branch review L4: the same number as `tel` (with its "tel:" prefix stripped),
   * formatted nationally for display — "(281) 555-0142" rather than the raw "+12815550142" the
   * Call button's `href` uses. Null exactly when `tel` is null. */
  telDisplay: string | null;
};

/**
 * Whole-branch review L4: a tiny local +1 phone parser/formatter, not `normalizePhone`
 * (`src/lib/extract/normalize.ts`) — that module pulls in `libphonenumber-js` and the `tlds`
 * package for its email-side logic, neither of which this client-rendered module (imported from
 * `src/components/leads/ManualAssists.tsx`, a component `PeopleSection` always renders) should add
 * to the browser bundle just to parse a phone number that — per the plan's own note — already
 * arrives as a clean Google phone contact (E.164 or a plain 10-digit US number) in practice. Only
 * handles the shapes that actually occur here: 10 digits (implicit +1) or 11 digits starting with
 * "1" (explicit +1) — anything else (a non-US number, a garbled value) yields `null` rather than
 * guessing.
 */
function parseUsPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

/** Formats a `+1XXXXXXXXXX` string parsed by `parseUsPhone` as "(XXX) XXX-XXXX". */
function formatNational(e164: string): string {
  const digits = e164.slice(2); // strip "+1"
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/**
 * Plan 10 Task 4: quick manual assists for a lead where no database knows the real point of
 * contact — pure search-engine links (no API call, no credit) plus a `tel:` prompt to call the
 * business's own number and ask. `city` comes from `regionFromAddress` on the lead's own address
 * (never a region literal — see the plan's Global Constraints), so this reads right for a lead
 * anywhere, not just the app's home metro.
 *
 * `websiteUrl` travels in the input shape for parity with the business object every caller
 * already has on hand (LeadDetail's `Detail`/PeopleSection's `business` prop), but isn't used by
 * any of the four links below — none of them benefit from the lead's own site.
 */
export function assistLinks(b: {
  name: string;
  formattedAddress: string | null;
  websiteUrl: string | null;
  phone: string | null;
}): AssistLinks {
  const { city } = regionFromAddress(b.formattedAddress);
  const nameCity = city ? `${b.name} ${city}` : b.name;
  const linkedinPeople = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(nameCity)}`;
  const facebookPages = `https://www.facebook.com/search/pages/?q=${encodeURIComponent(nameCity)}`;
  const googleQuery = city ? `"${b.name}" ${city} owner` : `"${b.name}" owner`;
  const googleOwner = `https://www.google.com/search?q=${encodeURIComponent(googleQuery)}`;
  const normalized = b.phone ? parseUsPhone(b.phone) : null;
  const tel = normalized ? `tel:${normalized}` : null;
  const telDisplay = normalized ? formatNational(normalized) : null;
  return { linkedinPeople, facebookPages, googleOwner, tel, telDisplay };
}
