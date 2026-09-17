// Domains for booking/scheduling platforms, POS/e-commerce SaaS, site builders, delivery
// marketplaces, and other third-party services whose own support/system addresses leak into
// scraped SMB website markup (embedded booking widgets, "powered by" footers, unfinished
// site-builder template placeholders, delivery-app badges). An address at one of these domains —
// or any subdomain of one — is never the business's own contact, no matter how clean it looks
// syntactically (it passes MX/TLD checks and can score the business green), so it's dropped
// rather than kept as a lead contact.
//
// Seed list from docs/superpowers/plans/2026-09-17-plan8-lead-detail-polish.md Task 5, extended
// (2026-09-17) from a read-only `Contact.value` domain-count query against the dev database:
//   - janeapp.com: health/wellness booking software, same category as mindbodyonline.com /
//     fresha.com / styleseat.com / schedulicity.com already below.
//   - placester.com: real-estate-agent website hosting, same category as the other site builders.
//   - townsquareinteractive.com: SMB website/digital-marketing platform (same site-builder
//     category as godaddysites.com / wix / squarespace).
//   - schoolwebsite.com, exampleemail.com: generic unfinished-template placeholder domains, same
//     category as yoursite.com / yourdomain.com / domain.com below.
// Domains that only *look* like SMB names sharing a word with a platform (e.g. a hypothetical
// "vagarosalon.com") are deliberately NOT included — `isPlatformEmail` below only matches the
// domain itself or a subdomain of it, never a substring.
//
// NOTE: "email.com" was deliberately removed (whole-branch review, L2) — mail.com sells real
// "@email.com" mailboxes, so it's a legitimate address domain, not a placeholder/platform one.
export const PLATFORM_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  "vagaro.com",
  "booksy.com",
  "godaddy.com",
  "godaddysites.com",
  "wix.com",
  "wixpress.com",
  "wixsite.com",
  "squarespace.com",
  "shopify.com",
  "myshopify.com",
  "clover.com",
  "squareup.com",
  "square.site",
  "toasttab.com",
  "mindbodyonline.com",
  "fresha.com",
  "styleseat.com",
  "schedulicity.com",
  "zocdoc.com",
  "doordash.com",
  "ubereats.com",
  "grubhub.com",
  "linktr.ee",
  "weebly.com",
  "jimdo.com",
  "duda.co",
  "wordpress.com",
  "wordpress.org",
  "sentry.io",
  "yelp.com",
  "facebook.com",
  "google.com",
  "example.com",
  "domain.com",
  "yoursite.com",
  "yourdomain.com",
  "w3.org",
  // Additions from the dev-DB domain-count query (see comment above).
  "janeapp.com",
  "placester.com",
  "townsquareinteractive.com",
  "schoolwebsite.com",
  "exampleemail.com",
  // Merged in (whole-branch review, L2) from `SHARED_HOSTS` in src/lib/jobs/enrich.ts, which used
  // to keep its own separate, diverging list of the same category of platform hosts; that
  // function now derives SHARED_HOSTS from this set instead, so it's the one source of truth for
  // "this domain is a shared platform, never a lead's own domain or contact address."
  "sites.google.com",
  "business.site",
  "jimdosite.com",
  "webnode.page",
  "carrd.co",
  "bio.site",
  // New platform domains (whole-branch review, L2).
  "blogspot.com",
  "order.online",
  "glossgenius.com",
  "acuityscheduling.com",
  "as.me",
  "setmore.com",
]);

/** True when `email`'s domain is exactly a known platform domain, or a subdomain of one. */
export function isPlatformEmail(email: string): boolean {
  const domain = email.trim().toLowerCase().split("@")[1];
  if (!domain) return false;
  for (const d of PLATFORM_EMAIL_DOMAINS) {
    if (domain === d || domain.endsWith(`.${d}`)) return true;
  }
  return false;
}
