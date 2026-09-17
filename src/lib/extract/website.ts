import * as cheerio from "cheerio";
import { detectProvider } from "@/lib/scoring/providerDetect";
import { safeFetch, readCapped, discardBody } from "@/lib/net/safeFetch";
import { UnsafeUrlError } from "@/lib/net/ssrf";
import {
  classifySocialUrl,
  isPlausibleTld,
  longestPlausibleTldPrefix,
  normalizeEmail,
  normalizePhone,
  normalizeWebsiteUrl,
  type SocialType,
} from "./normalize";

export const USER_AGENT = "SDR-LeadGen/1.0 (+contact info research)";
export const REQUEST_TIMEOUT_MS = 10_000;
const MAX_HTML_BYTES = 2_000_000;
const MAX_EXTRA_PAGES = 3;

export type FetchResult =
  | { ok: true; status: number; html: string; finalUrl: string }
  | { ok: false; status?: number; error: string };

export type PageFetcher = (url: string) => Promise<FetchResult>;

export const defaultFetcher: PageFetcher = async (url) => {
  try {
    const res = await safeFetch(
      url,
      { headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1" } },
      { timeoutMs: REQUEST_TIMEOUT_MS },
    );
    if (!res.ok) {
      void discardBody(res);
      return { ok: false, status: res.status, error: `HTTP ${res.status}` };
    }
    const ct = res.headers.get("content-type") ?? "";
    if (!/text\/html|application\/xhtml/i.test(ct)) {
      void discardBody(res);
      return { ok: true, status: res.status, html: "", finalUrl: res.url };
    }
    const html = await readCapped(res, MAX_HTML_BYTES);
    return { ok: true, status: res.status, html, finalUrl: res.url };
  } catch (e) {
    const err = e as Error;
    if (err instanceof UnsafeUrlError) return { ok: false, error: err.message };
    return { ok: false, error: err?.name === "AbortError" ? "timeout" : err?.message ?? String(e) };
  }
};

export type ExtractedContacts = {
  reachable: boolean;
  error?: string;
  pagesFetched: string[];
  emails: string[];
  phones: string[];
  socials: { type: SocialType; url: string }[];
  providerHint: { provider: string; evidence: string } | null;
};

const CONTACT_LINK_RE = /contact|about|reach|team|staff|location/i;
// Bounded on both sides: the lookbehind/lookahead stop the local part and TLD from swallowing
// adjacent glued text (they use [a-z] rather than the full local charset so digits right after
// the TLD still terminate the match). The TLD group allows up to 24 letters so a glued suffix
// like "comsubmitthanks" is captured whole and can then be trimmed to its longest plausible
// prefix, rather than being accepted outright as a long TLD.
const EMAIL_SCAN_RE = /(?<![a-z0-9._%+-])([a-z0-9._%+-]+)@([a-z0-9.-]+)\.([a-z]{2,24})(?![a-z])/gi;
const OBFUSCATED_RE =
  /([a-z0-9._%+-]+)\s*(?:\[at\]|\(at\)|\{at\})\s*([a-z0-9.-]+)\s*(?:\[dot\]|\(dot\)|\{dot\})\s*([a-z]{2,})/gi;
const PHONE_SCAN_RE = /(?:\+?1[\s.-]?)?\(?\b[2-9]\d{2}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g;
// A local part that begins with a phone-number or zip-code fragment glued on by adjacent page
// text with no separator (e.g. "77581info@…" from a zip code, "-229-4384chefstevehaug@…" from a
// phone number). Trimmed to the part after the fragment when what's left is plausibly a real
// local part (>= 2 chars, starts with a letter); otherwise the whole match is dropped.
const GLUED_LOCAL_RE = /^(?:-?\d{3}-\d{4}|\d{5})([a-z].*)$/i;

function repairGluedLocal(local: string): string | null {
  const m = GLUED_LOCAL_RE.exec(local);
  if (!m) return local;
  const rest = m[1];
  return rest.length >= 2 ? rest : null;
}

export function pickCandidatePages(baseUrl: string, html: string, max = MAX_EXTRA_PAGES): string[] {
  const base = new URL(baseUrl);
  const $ = cheerio.load(html);
  const found: string[] = [];
  $("a[href]").each((_, a) => {
    const href = $(a).attr("href") ?? "";
    const text = $(a).text();
    if (!CONTACT_LINK_RE.test(href) && !CONTACT_LINK_RE.test(text)) return;
    try {
      const u = new URL(href, base);
      if (u.hostname !== base.hostname) return;
      if (/\.(pdf|jpe?g|png|gif)$/i.test(u.pathname)) return;
      const clean = `${u.protocol}//${u.hostname}${u.pathname.replace(/\/+$/, "") || "/"}`;
      if (clean === `${base.protocol}//${base.hostname}/`) return;
      if (!found.includes(clean)) found.push(clean);
    } catch {
      /* ignore bad hrefs */
    }
  });
  if (found.length === 0) {
    found.push(`${base.protocol}//${base.hostname}/contact`, `${base.protocol}//${base.hostname}/about`);
  }
  return found.slice(0, max);
}

type PageExtract = { emails: Set<string>; phones: Set<string>; socials: Map<string, { type: SocialType; url: string }>; text: string };

export function extractFromHtml(html: string): PageExtract {
  const $ = cheerio.load(html);
  const emails = new Set<string>();
  const phones = new Set<string>();
  const socials = new Map<string, { type: SocialType; url: string }>();

  $("a[href]").each((_, a) => {
    const href = $(a).attr("href") ?? "";
    if (/^mailto:/i.test(href)) {
      const e = normalizeEmail(href);
      if (e) emails.add(e);
    } else if (/^tel:/i.test(href)) {
      const p = normalizePhone(href);
      if (p) phones.add(p);
    } else {
      const s = classifySocialUrl(href);
      if (s) socials.set(s.url, s);
    }
  });

  // Scan text from a separately-parsed DOM with a separator inserted at every tag boundary, so
  // adjacent text nodes (e.g. neighboring table cells or spans with no whitespace between them
  // in the source HTML) never fuse into one glued token — this is how "77581" + "info@…" became
  // "77581info@…" in the wild. The href-based extraction above still uses the original `$`.
  const $text = cheerio.load(html.replace(/>/g, "> "));
  $text("script, style, noscript").remove();
  const text = $text("body").text().replace(/\s+/g, " ").trim();

  for (const m of text.matchAll(EMAIL_SCAN_RE)) {
    const [, rawLocal, domain, rawTld] = m;
    const tld = isPlausibleTld(rawTld) ? rawTld.toLowerCase() : longestPlausibleTldPrefix(rawTld);
    if (!tld) continue;
    const local = repairGluedLocal(rawLocal.toLowerCase());
    if (!local) continue;
    const e = normalizeEmail(`${local}@${domain.toLowerCase()}.${tld}`);
    if (e) emails.add(e);
  }
  for (const m of text.matchAll(OBFUSCATED_RE)) {
    const e = normalizeEmail(`${m[1]}@${m[2]}.${m[3]}`);
    if (e) emails.add(e);
  }
  for (const m of text.matchAll(PHONE_SCAN_RE)) {
    const p = normalizePhone(m[0]);
    if (p) phones.add(p);
  }
  return { emails, phones, socials, text };
}

export async function extractWebsiteContacts(
  websiteUrl: string,
  fetcher: PageFetcher = defaultFetcher,
  opts?: { beforeFetch?: () => Promise<void> },
): Promise<ExtractedContacts> {
  const empty: ExtractedContacts = { reachable: false, pagesFetched: [], emails: [], phones: [], socials: [], providerHint: null };
  const home = normalizeWebsiteUrl(websiteUrl);
  if (!home) return { ...empty, error: "invalid url" };

  await opts?.beforeFetch?.();
  const first = await fetcher(home);
  if (!first.ok) return { ...empty, error: first.error };

  const pagesFetched = [home];
  const merged = extractFromHtml(first.html);
  let allText = merged.text;

  for (const url of pickCandidatePages(first.finalUrl || home, first.html)) {
    await opts?.beforeFetch?.();
    const res = await fetcher(url);
    if (!res.ok) continue;
    pagesFetched.push(url);
    const part = extractFromHtml(res.html);
    part.emails.forEach((e) => merged.emails.add(e));
    part.phones.forEach((p) => merged.phones.add(p));
    part.socials.forEach((s, k) => merged.socials.set(k, s));
    allText += " " + part.text;
  }

  return {
    reachable: true,
    pagesFetched,
    emails: [...merged.emails].sort(),
    phones: [...merged.phones].sort(),
    socials: [...merged.socials.values()].sort((a, b) => a.type.localeCompare(b.type)),
    providerHint: detectProvider(allText),
  };
}
