import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { extractWebsiteContacts, extractFromHtml, pickCandidatePages, defaultFetcher, type PageFetcher } from "@/lib/extract/website";
import * as safeFetchMod from "@/lib/net/safeFetch";

const fixture = (name: string) =>
  readFileSync(path.join(import.meta.dirname, "../../fixtures/html", name), "utf8");

const fetcher: PageFetcher = async (url) => {
  if (url === "https://bellanails.com/") return { ok: true, status: 200, html: fixture("nails-home.html"), finalUrl: url };
  if (url === "https://bellanails.com/contact-us") return { ok: true, status: 200, html: fixture("nails-contact.html"), finalUrl: url };
  return { ok: false, status: 404, error: "HTTP 404" };
};

describe("extractWebsiteContacts", () => {
  it("collects emails, phones, socials, and a provider hint across pages", async () => {
    const r = await extractWebsiteContacts("bellanails.com", fetcher);
    expect(r.reachable).toBe(true);
    expect(r.pagesFetched).toEqual(["https://bellanails.com/", "https://bellanails.com/contact-us"]);
    expect(r.emails).toEqual(["ana@bellanails.com", "hello@bellanails.com"]);
    expect(r.phones).toEqual(["+17135550100", "+17135550199"]);
    expect(r.socials).toEqual([
      { type: "facebook", url: "https://www.facebook.com/bellanailshouston" },
      { type: "instagram", url: "https://instagram.com/bellanails" },
      { type: "linkedin", url: "https://www.linkedin.com/company/bella-nails-spa" },
      { type: "yelp", url: "https://www.yelp.com/biz/bella-nails-houston" },
    ]);
    expect(r.providerHint?.provider).toBe("att");
  });

  it("reports unreachable sites without throwing", async () => {
    const dead: PageFetcher = async () => ({ ok: false, error: "timeout" });
    const r = await extractWebsiteContacts("https://dead.example", dead);
    expect(r.reachable).toBe(false);
    expect(r.error).toBe("timeout");
    expect(r.emails).toEqual([]);
  });

  it("falls back to /contact and /about when no links match", () => {
    const pages = pickCandidatePages("https://x.com/", "<html><body><a href='/menu'>Menu</a></body></html>");
    expect(pages).toEqual(["https://x.com/contact", "https://x.com/about"]);
  });
});

describe("extractFromHtml email boundary fix", () => {
  it("does not glue trailing text onto the domain's TLD", () => {
    const r = extractFromHtml("<p>Contact: blacklisttattoocotx@gmail.comSubmitThanks</p>");
    expect([...r.emails]).toEqual(["blacklisttattoocotx@gmail.com"]);
  });

  it("prefers the mailto href over scanned text and strips the query string", () => {
    // NOTE: the plan's own example domain for this case was "example.com", but that domain is
    // also required (by the Interfaces section, and by the pre-existing
    // normalizeEmail("user@example.com") -> null test) to be rejected as a placeholder. Both
    // requirements can't hold for the same address, so this case uses a non-placeholder domain
    // to test the actual behavior under test: mailto: preference + query-string stripping.
    const r = extractFromHtml('<p>Email us: <a href="mailto:info@realbiz.com?subject=Hi">info@realbiz.com</a></p>');
    expect([...r.emails]).toEqual(["info@realbiz.com"]);
  });

  it("takes the longest plausible TLD prefix for a listed small-business gTLD glued to trailing text", () => {
    const r = extractFromHtml("<p>sales@shop.onlineOrder now</p>");
    expect([...r.emails]).toEqual(["sales@shop.online"]);
  });

  it("drops an address whose TLD has no plausible prefix", () => {
    const r = extractFromHtml("<p>foo@bar.notatld</p>");
    expect([...r.emails]).toEqual([]);
  });

  it("recovers a genuine .style address glued to trailing text", () => {
    const r = extractFromHtml("<p>info@rawlife.stylestore</p>");
    expect([...r.emails]).toEqual(["info@rawlife.style"]);
  });

  it("trims a zip-code fragment glued before the local part", () => {
    const r = extractFromHtml("<p>77581info@eatportara.com</p>");
    expect([...r.emails]).toEqual(["info@eatportara.com"]);
  });

  it("trims a phone-number fragment glued before the local part", () => {
    const r = extractFromHtml("<p>-229-4384chefstevehaug@gmail.com</p>");
    expect([...r.emails]).toEqual(["chefstevehaug@gmail.com"]);
  });

  it("does not fuse adjacent text nodes across tag boundaries with no separator", () => {
    // Reproduces the real bug mechanism: a zip/route-code cell sits directly next to an email
    // cell with no whitespace text node between them in the source HTML, so cheerio's $.text()
    // used to concatenate them into "77581info@eatportara.com". With a separator inserted at
    // every tag boundary, "77581" and "info@eatportara.com" stay distinct words, so the scanner
    // never even sees a glued local part here.
    const r = extractFromHtml("<table><tr><td>77581</td><td>info@eatportara.com</td></tr></table>");
    expect([...r.emails]).toEqual(["info@eatportara.com"]);
  });

  it("drops a site-builder placeholder address found in scanned text", () => {
    const r = extractFromHtml("<p>filler@godaddy.com</p>");
    expect([...r.emails]).toEqual([]);
  });
});

function fakeBody() {
  // A real (small) stream: the discard path drains it to completion, so "released" means the
  // stream was fully read or cancelled — either way the socket can be reused/closed.
  const state = { drained: false, cancelled: false, get released() { return state.drained || state.cancelled; } };
  const stream = new ReadableStream<Uint8Array>({
    start(c) { c.enqueue(new Uint8Array(64)); c.close(); state.drained = true; },
    cancel() { state.cancelled = true; },
  });
  return Object.assign(state, { stream });
}

describe("defaultFetcher body cancellation on early-return paths", () => {
  afterEach(() => vi.restoreAllMocks());

  it("cancels the response body on a non-ok response", async () => {
    const body = fakeBody();
    vi.spyOn(safeFetchMod, "safeFetch").mockResolvedValue({
      ok: false,
      status: 404,
      url: "https://dead.example/",
      headers: new Headers({ "content-type": "text/html" }),
      body: body.stream,
    } as unknown as Response);
    const r = await defaultFetcher("https://dead.example/");
    expect(r).toMatchObject({ ok: false, status: 404 });
    expect(body.released).toBe(true);
  });

  it("cancels the response body on a non-HTML content-type", async () => {
    const body = fakeBody();
    vi.spyOn(safeFetchMod, "safeFetch").mockResolvedValue({
      ok: true,
      status: 200,
      url: "https://x.com/menu.pdf",
      headers: new Headers({ "content-type": "application/pdf" }),
      body: body.stream,
    } as unknown as Response);
    const r = await defaultFetcher("https://x.com/menu.pdf");
    expect(r).toMatchObject({ ok: true, html: "" });
    expect(body.released).toBe(true);
  });
});
