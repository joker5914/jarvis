import { describe, it, expect } from "vitest";
import { normalizeEmail, normalizePhone, classifySocialUrl, normalizeWebsiteUrl } from "@/lib/extract/normalize";

describe("normalizeEmail", () => {
  it("lowercases and strips mailto and query", () => {
    expect(normalizeEmail("mailto:Hello@BellaNails.com?subject=Hi")).toBe("hello@bellanails.com");
  });
  it("rejects image names and junk", () => {
    expect(normalizeEmail("logo@2x.png")).toBeNull();
    expect(normalizeEmail("user@example.com")).toBeNull();
    expect(normalizeEmail("not-an-email")).toBeNull();
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
