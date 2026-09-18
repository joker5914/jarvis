import { describe, it, expect } from "vitest";
import { domainFromUrl } from "@/lib/extract/domains";

// Fix round for 3eed43d: domainFromUrl moved out of src/lib/jobs/enrich.ts (which imports
// prisma, so it can't be pulled into a client bundle) into this prisma-free module, so
// PeopleSection/LeadDetail can compute the exact same "no usable domain" hint the server uses in
// POST /businesses/:id/candidates — a plain `websiteUrl == null` check used to miss a
// platform-hosted website (e.g. a Booksy storefront), understating the credit cost the button
// showed before the click. tests/unit/jobs/enrichHelpers.test.ts still exercises the same cases
// through the src/lib/jobs/enrich.ts re-export.
describe("domainFromUrl (client-safe module)", () => {
  it.each([
    ["https://www.BellaNails.com/contact", "bellanails.com"],
    [null, null],
    ["not a url", null],
    ["https://facebook.com/bella", null],
    // Booking/POS/site-builder platform hosts (src/lib/extract/platformDomains.ts's
    // PLATFORM_EMAIL_DOMAINS): a lead's page on one of these is never the lead's own domain.
    ["https://whiskeyblades.booksy.com/", null],
    ["https://clover.com/online-ordering/whiskey-blades", null],
    ["https://www.zerotrainingcenter.com/", "zerotrainingcenter.com"],
  ])("%s → %s", (input, out) => expect(domainFromUrl(input)).toBe(out));
});
