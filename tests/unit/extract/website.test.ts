import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { extractWebsiteContacts, pickCandidatePages, defaultFetcher, type PageFetcher } from "@/lib/extract/website";
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

function fakeBody() {
  const body = { cancelled: false, cancel: async () => { body.cancelled = true; } };
  return body;
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
      body,
    } as unknown as Response);
    const r = await defaultFetcher("https://dead.example/");
    expect(r).toMatchObject({ ok: false, status: 404 });
    expect(body.cancelled).toBe(true);
  });

  it("cancels the response body on a non-HTML content-type", async () => {
    const body = fakeBody();
    vi.spyOn(safeFetchMod, "safeFetch").mockResolvedValue({
      ok: true,
      status: 200,
      url: "https://x.com/menu.pdf",
      headers: new Headers({ "content-type": "application/pdf" }),
      body,
    } as unknown as Response);
    const r = await defaultFetcher("https://x.com/menu.pdf");
    expect(r).toMatchObject({ ok: true, html: "" });
    expect(body.cancelled).toBe(true);
  });
});
