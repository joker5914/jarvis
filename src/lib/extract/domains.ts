import { PLATFORM_EMAIL_DOMAINS } from "./platformDomains";

// Hosts that never identify a business's own domain: social/review profile pages (the original
// set) plus, per live zero-credit probes, booking/scheduling/ordering platforms whose page for a
// lead (e.g. a Booksy or Clover storefront) makes Apollo's People Search return the *platform's*
// executives instead of the lead's — see orgNameMatches's callers in src/lib/jobs/enrich.ts for
// the second half of that guard.
//
// This module has no imports beyond platformDomains.ts (itself import-free) so it can be pulled
// into client bundles: PeopleSection/LeadDetail need `domainFromUrl` to compute the same
// "no usable domain → a 'Find people' click costs a credit" hint the server uses in
// POST /businesses/:id/candidates, and src/lib/jobs/enrich.ts is not client-safe (it imports
// prisma). enrich.ts re-exports `domainFromUrl` from here so its existing server-side callers
// and tests are unaffected.
const SOCIAL_HOSTS = ["facebook.com", "instagram.com", "linkedin.com", "yelp.com", "twitter.com", "x.com"];
const SHARED_HOSTS = [...new Set([...SOCIAL_HOSTS, ...PLATFORM_EMAIL_DOMAINS])];

export function domainFromUrl(url: string | null): string | null {
  if (!url) return null;
  const raw = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  try {
    const host = new URL(raw).hostname.toLowerCase().replace(/^www\./, "");
    if (!host.includes(".")) return null;
    if (SHARED_HOSTS.some((s) => host === s || host.endsWith(`.${s}`))) return null;
    return host;
  } catch {
    return null;
  }
}
