import { describe, it, expect } from "vitest";
import { isPlatformEmail, PLATFORM_EMAIL_DOMAINS } from "@/lib/extract/platformDomains";

// Task 5: booking/site-builder/support platform addresses (support@vagaro.com,
// safeguarding@vagaro.com, filler@godaddy.com, hello@booksy.com) pass syntax and MX checks,
// score the business green, and are useless for outreach — they're never the business's own
// contact, so they must be dropped regardless of how clean they look.
describe("isPlatformEmail", () => {
  it("matches an exact platform domain", () => {
    expect(isPlatformEmail("support@vagaro.com")).toBe(true);
  });

  it("matches a subdomain of a platform domain", () => {
    expect(isPlatformEmail("x@app.vagaro.com")).toBe(true);
  });

  it("does not match an SMB domain that merely shares a word with a platform domain", () => {
    expect(isPlatformEmail("info@vagarosalon.com")).toBe(false);
  });

  it("matches seed-list platform domains across categories (booking, site builder, delivery, placeholder)", () => {
    expect(isPlatformEmail("hello@booksy.com")).toBe(true);
    expect(isPlatformEmail("filler@godaddy.com")).toBe(true);
    expect(isPlatformEmail("orders@doordash.com")).toBe(true);
    expect(isPlatformEmail("info@yourdomain.com")).toBe(true);
  });

  it("matches domains added from the dev-DB read-only domain query", () => {
    expect(isPlatformEmail("noreply@janeapp.com")).toBe(true);
    expect(isPlatformEmail("support@placester.com")).toBe(true);
    expect(isPlatformEmail("help@townsquareinteractive.com")).toBe(true);
    expect(isPlatformEmail("info@schoolwebsite.com")).toBe(true);
    expect(isPlatformEmail("test@exampleemail.com")).toBe(true);
  });

  it("returns false for a string with no domain", () => {
    expect(isPlatformEmail("not-an-email")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(isPlatformEmail("Support@VAGARO.COM")).toBe(true);
  });

  it("PLATFORM_EMAIL_DOMAINS is non-empty and lowercase", () => {
    expect(PLATFORM_EMAIL_DOMAINS.size).toBeGreaterThan(0);
    for (const d of PLATFORM_EMAIL_DOMAINS) expect(d).toBe(d.toLowerCase());
  });
});
