import { parsePhoneNumberFromString } from "libphonenumber-js";
import ianaTlds from "tlds";
import { isPlatformEmail } from "./platformDomains";

export type SocialType = "linkedin" | "facebook" | "instagram" | "twitter" | "yelp";

// Syntax check only; TLD plausibility is validated separately via `isPlausibleTld` so a mangled
// TLD (e.g. "comsubmitthanks") is rejected instead of silently accepted as a long generic TLD.
const EMAIL_RE = /^([a-z0-9._%+-]+)@([a-z0-9.-]+)\.([a-z]{2,24})$/;
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|svg|webp|ico)$/;

// The full IANA TLD list (via the `tlds` npm package, pinned in package.json), lowercased. A
// hand-picked allow-list previously lived here and silently mis-rewrote or dropped real gTLD
// addresses it didn't happen to include (e.g. ".technology", ".contractors", ".attorney",
// ".dentist" were either glued down to a shorter look-alike prefix or rejected outright). The
// IANA list is the actual ground truth for "is this a real TLD" and needs no manual curation.
export const KNOWN_TLDS = new Set(
  ianaTlds.map((t) => t.toLowerCase()).concat(
    // ".test" is IANA/RFC 2606 reserved for testing and can never be a real business's TLD; it's
    // included so the existing test-fixture convention (e.g. "*.fake.test" in
    // src/lib/providers/fake.ts and tests/db/*.test.ts) keeps validating as before.
    "test",
  ),
);

export function isPlausibleTld(tld: string): boolean {
  const t = tld.toLowerCase();
  return t.length === 2 || KNOWN_TLDS.has(t);
}

/**
 * Given a TLD that already failed `isPlausibleTld` (i.e. it's neither a 2-letter code nor in
 * `KNOWN_TLDS` as-is), find the longest leading prefix that IS in `KNOWN_TLDS` — e.g.
 * "comsubmitthanks" -> "com", "stylestore" -> "style". Only ever runs for a captured TLD that is
 * NOT itself an IANA TLD (that's what makes it "the glued case" rather than a real TLD we should
 * have accepted as-is via `isPlausibleTld`).
 *
 * The minimum prefix length is 3, not 2: `KNOWN_TLDS` now comes from the full IANA list (see its
 * doc comment), which includes every 2-letter ccTLD ("no", "la", "me", ...). If this loop allowed
 * length-2 matches, junk like "notatld" or "com.last" would spuriously recover as ".no" / ".la"
 * — a real ccTLD by coincidence of spelling, not because the address actually uses it. Genuine
 * 2-letter ccTLDs are already accepted directly by `isPlausibleTld`'s length check, so this
 * function never needs to manufacture one out of a longer junk string.
 *
 * Because glued TLDs can themselves be IANA TLDs by accident (e.g. "company", "center", "codes"
 * are real gTLDs), a glued suffix can occasionally recover to the wrong-but-real TLD instead of
 * the correct short one — e.g. "x.com" glued to trailing text that happens to spell out
 * "company" recovers as ".company" rather than ".com". That misattribution is accepted as a rare,
 * low-stakes false-normalization limited to this glued-junk-recovery path.
 */
export function longestPlausibleTldPrefix(tld: string): string | null {
  const t = tld.toLowerCase();
  for (let len = Math.min(t.length, 24) - 1; len >= 3; len--) {
    const prefix = t.slice(0, len);
    if (KNOWN_TLDS.has(prefix)) return prefix;
  }
  return null;
}

// Domains that are always junk regardless of local part: generic examples/docs domains and
// known site-builder/ESP domains that leak into scraped markup (e.g. "filler@godaddy.com" left
// over from an unfinished GoDaddy site builder template).
const PLACEHOLDER_DOMAINS = [
  "example.com", "example.org", "example.net", "domain.com",
  "yourdomain.com", "yourcompany.com", "company.com", "test.com",
  "sentry.io", "wixpress.com", "squarespace.com", "godaddy.com",
  "mysite.com", "website.com",
];
const placeholderDomainAlt = PLACEHOLDER_DOMAINS.map((d) => d.replace(/\./g, "\\.")).join("|");
export const PLACEHOLDER_EMAIL_RE = new RegExp(`@(?:[a-z0-9-]+\\.)*(?:${placeholderDomainAlt})$`, "i");

/**
 * `normalizeEmail`'s contract: given a raw candidate string (optionally a `mailto:` href with a
 * query string), return the lowercased, canonical address, or `null` if it fails any of —
 *   - syntax (`EMAIL_RE`),
 *   - TLD plausibility (`isPlausibleTld`),
 *   - looking like an image filename mistaken for an address (`IMAGE_EXT_RE`),
 *   - a generic placeholder/example domain (`PLACEHOLDER_EMAIL_RE`), or
 *   - a third-party platform/support domain (`isPlatformEmail` — booking/e-commerce SaaS, site
 *     builders, delivery marketplaces, etc.; see `platformDomains.ts`) — these pass every check
 *     above yet are never the business's own contact.
 * It deliberately does NOT detect a syntactically valid local part that's actually a phone/zip
 * fragment glued on by adjacent page text (e.g. "77581info@eatportara.com" — "77581" is a zip
 * code, not part of the real local part "info"): that's the scanner's job at extraction time
 * (`repairGluedLocal` in `website.ts`) and the cleanup script's job for rows already stored
 * (`isGluedEmail`/`isJunkEmail` in `junk.ts`). Keeping that check out of `normalizeEmail` matters
 * because the function is also called directly on stored values (e.g. by the cleanup script) to
 * ask "would today's validator still accept this raw string as its own canonical form" — folding
 * in a repair step would make it silently rewrite instead of reject.
 */
export function normalizeEmail(raw: string): string | null {
  let s = raw.trim().toLowerCase();
  if (s.startsWith("mailto:")) s = s.slice(7);
  s = s.split("?")[0];
  const m = EMAIL_RE.exec(s);
  if (!m) return null;
  const tld = m[3];
  if (!isPlausibleTld(tld)) return null;
  if (IMAGE_EXT_RE.test(s)) return null;
  if (PLACEHOLDER_EMAIL_RE.test(s)) return null;
  if (isPlatformEmail(s)) return null;
  return s;
}

export function normalizePhone(raw: string): string | null {
  const s = raw.trim().replace(/^tel:/i, "");
  const p = parsePhoneNumberFromString(s, "US");
  if (!p || !p.isValid()) return null;
  return p.number;
}

const SHARE_PATH_RE = /\/(sharer|share|intent|dialog|plugins)\b/i;

export function classifySocialUrl(href: string): { type: SocialType; url: string } | null {
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const path = u.pathname.replace(/\/+$/, "");
  if (SHARE_PATH_RE.test(path) || path === "") return null;

  let type: SocialType | null = null;
  if (host === "linkedin.com" || host.endsWith(".linkedin.com")) type = "linkedin";
  else if (host === "facebook.com" || host === "fb.com" || host.endsWith(".facebook.com")) type = "facebook";
  else if (host === "instagram.com" || host.endsWith(".instagram.com")) type = "instagram";
  else if (host === "twitter.com" || host === "x.com" || host.endsWith(".twitter.com")) type = "twitter";
  else if (host === "yelp.com" || host.endsWith(".yelp.com")) type = "yelp";
  if (!type) return null;

  return { type, url: `${u.protocol}//${u.hostname.toLowerCase()}${path}` };
}

export function normalizeWebsiteUrl(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(withScheme);
    if (!u.hostname.includes(".")) return null;
    return `${u.protocol}//${u.hostname.toLowerCase()}${u.pathname}`;
  } catch {
    return null;
  }
}
