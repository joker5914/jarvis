import { describe, it, expect } from "vitest";
import { businessesToCsv } from "@/lib/leads/csv";

describe("businessesToCsv", () => {
  it("writes a header and escapes quotes, commas, and newlines", () => {
    const csv = businessesToCsv([
      {
        name: 'Bella "B" Nails, LLC',
        primaryCategory: "nail_salon",
        zip: "77084",
        formattedAddress: "1 Main St, Houston, TX",
        phone: "(713) 555-0100",
        websiteUrl: "https://bellanails.com/",
        contactQualityBand: "green",
        contactQualityScore: 75,
        outreachStatus: "contacted",
        suggestedPackage: "internet_mobile",
        currentProviderHint: "att",
        notes: "line1\nline2",
        productsPitched: ["mobile"],
        contacts: [
          { type: "email", value: "hello@bellanails.com", validationStatus: "valid", personName: null, personTitle: null },
          { type: "facebook", value: "https://www.facebook.com/bella", validationStatus: "unchecked", personName: null, personTitle: null },
        ],
        tags: [{ tag: { name: "hot" } }],
      } as never,
    ]);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe(
      "name,category,zip,address,phone,website,emails,socials,quality_band,quality_score,outreach_status,suggested_package,current_provider,products_pitched,tags,notes",
    );
    expect(lines[1]).toBe(
      '"Bella ""B"" Nails, LLC",nail_salon,77084,"1 Main St, Houston, TX",(713) 555-0100,https://bellanails.com/,hello@bellanails.com,https://www.facebook.com/bella,green,75,contacted,internet_mobile,att,mobile,hot,"line1\nline2"',
    );
  });
});
