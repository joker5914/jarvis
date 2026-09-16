import { parsePhoneNumberFromString } from "libphonenumber-js";

export type SocialType = "linkedin" | "facebook" | "instagram" | "twitter" | "yelp";

const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|svg|webp|ico)$/;
const JUNK_DOMAINS = ["example.com", "example.org", "sentry.io", "wixpress.com", "domain.com", "email.com", "yourdomain.com"];

export function normalizeEmail(raw: string): string | null {
  let s = raw.trim().toLowerCase();
  if (s.startsWith("mailto:")) s = s.slice(7);
  s = s.split("?")[0];
  if (!EMAIL_RE.test(s)) return null;
  if (IMAGE_EXT_RE.test(s)) return null;
  const domain = s.split("@")[1];
  if (JUNK_DOMAINS.some((j) => domain === j || domain.endsWith(`.${j}`))) return null;
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
