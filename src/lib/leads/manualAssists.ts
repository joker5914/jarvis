import { regionFromAddress } from "@/lib/extract/address";
import { normalizePhone } from "@/lib/extract/normalize";

export type AssistLinks = {
  linkedinPeople: string;
  facebookPages: string;
  googleOwner: string;
  tel: string | null;
};

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
  // The business's own phone is a Google phone contact — already E.164 in practice — but this
  // still runs it through normalizePhone (the same normalizer POST /people and zipSearch/promote
  // use) rather than trusting the stored value as-is, so a phone that somehow doesn't parse
  // yields `tel: null` instead of a dead link.
  const normalized = b.phone ? normalizePhone(b.phone) : null;
  const tel = normalized ? `tel:${normalized}` : null;
  return { linkedinPeople, facebookPages, googleOwner, tel };
}
