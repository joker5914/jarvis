import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { extractWebsiteContacts, pickCandidatePages, type PageFetcher } from "@/lib/extract/website";

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
