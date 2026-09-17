import { describe, it, expect } from "vitest";
import { normalizeEmail, normalizePhone, classifySocialUrl, normalizeWebsiteUrl, PLACEHOLDER_EMAIL_RE } from "@/lib/extract/normalize";

describe("normalizeEmail", () => {
  it("lowercases and strips mailto and query", () => {
    expect(normalizeEmail("mailto:Hello@BellaNails.com?subject=Hi")).toBe("hello@bellanails.com");
  });
  it("rejects image names and junk", () => {
    expect(normalizeEmail("logo@2x.png")).toBeNull();
    expect(normalizeEmail("user@example.com")).toBeNull();
    expect(normalizeEmail("not-an-email")).toBeNull();
  });

  it("rejects an address with text glued past the top-level domain", () => {
    expect(normalizeEmail("a@gmail.comsubmitthanks")).toBeNull();
  });
  it("accepts a clean two/three-letter generic TLD", () => {
    expect(normalizeEmail("a@gmail.com")).toBe("a@gmail.com");
  });
  it("accepts a listed small-business gTLD", () => {
    expect(normalizeEmail("a@shop.online")).toBe("a@shop.online");
  });
  it("accepts a two-letter country-code TLD", () => {
    expect(normalizeEmail("a@x.zz")).toBe("a@x.zz");
  });
  it("rejects an implausible made-up TLD", () => {
    expect(normalizeEmail("a@x.notatld")).toBeNull();
  });
  it("rejects a known site-builder placeholder address", () => {
    expect(normalizeEmail("filler@godaddy.com")).toBeNull();
  });
  it("rejects live-junk local-part phone/zip fragments (syntactically valid, semantically wrong) only via the cleanup script, not normalizeEmail alone", () => {
    // normalizeEmail only validates syntax + TLD plausibility + placeholder status; a glued local
    // part like "77581info@eatportara.com" is syntactically a valid email, so normalizeEmail
    // accepts it as-is. The scanner (website.ts) is responsible for trimming the fragment before
    // this function ever sees it, and the cleanup script flags it separately via isJunkEmail.
    expect(normalizeEmail("77581info@eatportara.com")).toBe("77581info@eatportara.com");
  });

  // Fix round (item 4): "realtor" is a real gTLD and common for small-business realtors.
  it("accepts the .realtor gTLD", () => {
    expect(normalizeEmail("jane@smith.realtor")).toBe("jane@smith.realtor");
  });

  // Task 5: platform/support addresses pass syntax, TLD, and placeholder checks but are never
  // the business's own contact — normalizeEmail rejects them directly (see its doc comment).
  it("rejects a booking/site-builder platform support address", () => {
    expect(normalizeEmail("support@vagaro.com")).toBeNull();
    expect(normalizeEmail("x@app.vagaro.com")).toBeNull();
  });
  it("accepts an SMB domain that merely shares a word with a platform domain", () => {
    expect(normalizeEmail("info@vagarosalon.com")).toBe("info@vagarosalon.com");
  });
});

describe("PLACEHOLDER_EMAIL_RE", () => {
  // Fix round (item 5a): the placeholder-domain match must be precise about the domain
  // boundary — "mysitecleaners.com" merely starts with the letters of "mysite" but is not the
  // placeholder domain "mysite.com" or a subdomain of it, so it must NOT match.
  it("does not match a domain that only shares a substring with a placeholder domain", () => {
    expect(PLACEHOLDER_EMAIL_RE.test("info@mysitecleaners.com")).toBe(false);
    expect(normalizeEmail("info@mysitecleaners.com")).toBe("info@mysitecleaners.com");
  });

  it("matches the actual placeholder domain", () => {
    expect(PLACEHOLDER_EMAIL_RE.test("info@mysite.com")).toBe(true);
    expect(normalizeEmail("info@mysite.com")).toBeNull();
  });
});

describe("normalizePhone", () => {
  it("returns E.164 for US numbers", () => {
    expect(normalizePhone("(713) 555-0100")).toBe("+17135550100");
    expect(normalizePhone("713.555.0199")).toBe("+17135550199");
    expect(normalizePhone("tel:+17135550100")).toBe("+17135550100");
  });
  it("rejects invalid", () => {
    expect(normalizePhone("123")).toBeNull();
  });
});

describe("classifySocialUrl", () => {
  it("classifies and canonicalizes", () => {
    expect(classifySocialUrl("https://instagram.com/bellanails?utm_source=site")).toEqual({
      type: "instagram",
      url: "https://instagram.com/bellanails",
    });
    expect(classifySocialUrl("https://www.linkedin.com/company/bella-nails-spa/")?.type).toBe("linkedin");
    expect(classifySocialUrl("https://x.com/bella")?.type).toBe("twitter");
    expect(classifySocialUrl("https://www.yelp.com/biz/bella")?.type).toBe("yelp");
  });
  it("ignores share links and non-social", () => {
    expect(classifySocialUrl("https://www.facebook.com/sharer/sharer.php?u=x")).toBeNull();
    expect(classifySocialUrl("https://twitter.com/intent/tweet?text=hi")).toBeNull();
    expect(classifySocialUrl("https://example.com")).toBeNull();
  });
});

describe("normalizeWebsiteUrl", () => {
  it("adds https and strips fragments", () => {
    expect(normalizeWebsiteUrl("bellanails.com/#home")).toBe("https://bellanails.com/");
    expect(normalizeWebsiteUrl("http://www.bellanails.com/menu?x=1")).toBe("http://www.bellanails.com/menu");
    expect(normalizeWebsiteUrl("")).toBeNull();
  });
});
