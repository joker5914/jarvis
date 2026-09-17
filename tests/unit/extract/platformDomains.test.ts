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

  // L2 (whole-branch review): domains added to consolidate with SHARED_HOSTS in enrich.ts, plus
  // new platform domains.
  it("matches domains merged in from SHARED_HOSTS and newly added platform domains", () => {
    expect(isPlatformEmail("info@sites.google.com")).toBe(true);
    expect(isPlatformEmail("hello@business.site")).toBe(true);
    expect(isPlatformEmail("hi@example.jimdosite.com")).toBe(true);
    expect(isPlatformEmail("hi@example.webnode.page")).toBe(true);
    expect(isPlatformEmail("hi@example.carrd.co")).toBe(true);
    expect(isPlatformEmail("hi@example.bio.site")).toBe(true);
    expect(isPlatformEmail("noreply@blogspot.com")).toBe(true);
    expect(isPlatformEmail("support@order.online")).toBe(true);
    expect(isPlatformEmail("hello@glossgenius.com")).toBe(true);
    expect(isPlatformEmail("support@acuityscheduling.com")).toBe(true);
    expect(isPlatformEmail("hi@as.me")).toBe(true);
    expect(isPlatformEmail("support@setmore.com")).toBe(true);
  });

  // L2: mail.com sells real "@email.com" mailboxes, so it must NOT be treated as a placeholder
  // or platform domain — an SMB really can have a genuine "@email.com" contact address.
  it("no longer treats email.com as a platform domain", () => {
    expect(isPlatformEmail("owner@email.com")).toBe(false);
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
