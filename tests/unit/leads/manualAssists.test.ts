import { describe, it, expect } from "vitest";
import { assistLinks } from "@/lib/leads/manualAssists";

describe("assistLinks", () => {
  it("builds LinkedIn/Facebook/Google links from the business name and city, city-first from regionFromAddress", () => {
    const links = assistLinks({
      name: "Bella Nails",
      formattedAddress: "123 Main St, Houston, TX 77002, USA",
      websiteUrl: null,
      phone: null,
    });
    expect(links.linkedinPeople).toBe(
      "https://www.linkedin.com/search/results/people/?keywords=" + encodeURIComponent("Bella Nails Houston"),
    );
    expect(links.facebookPages).toBe(
      "https://www.facebook.com/search/pages/?q=" + encodeURIComponent("Bella Nails Houston"),
    );
    expect(links.googleOwner).toBe(
      "https://www.google.com/search?q=" + encodeURIComponent('"Bella Nails" Houston owner'),
    );
  });

  it("falls back to the name alone when the address has no parseable city", () => {
    const links = assistLinks({ name: "Bella Nails", formattedAddress: null, websiteUrl: null, phone: null });
    expect(links.linkedinPeople).toBe(
      "https://www.linkedin.com/search/results/people/?keywords=" + encodeURIComponent("Bella Nails"),
    );
    expect(links.googleOwner).toBe(
      "https://www.google.com/search?q=" + encodeURIComponent('"Bella Nails" owner'),
    );
  });

  it("encodes a name with an ampersand and an apostrophe correctly (& escaped, apostrophe left as-is)", () => {
    const links = assistLinks({
      name: "Rosie's Bar & Grill",
      formattedAddress: "1 Elm St, Pearland, TX 77581, USA",
      websiteUrl: null,
      phone: null,
    });
    expect(links.linkedinPeople).toBe(
      "https://www.linkedin.com/search/results/people/?keywords=Rosie's%20Bar%20%26%20Grill%20Pearland",
    );
    expect(links.facebookPages).toBe(
      "https://www.facebook.com/search/pages/?q=Rosie's%20Bar%20%26%20Grill%20Pearland",
    );
    expect(links.googleOwner).toBe(
      "https://www.google.com/search?q=%22Rosie's%20Bar%20%26%20Grill%22%20Pearland%20owner",
    );
  });

  it("produces a tel: link from a parseable business phone", () => {
    const links = assistLinks({
      name: "Bella Nails",
      formattedAddress: null,
      websiteUrl: null,
      phone: "(713) 555-0100",
    });
    expect(links.tel).toBe("tel:+17135550100");
  });

  it("accepts an already-E.164 phone (Google phone contact) unchanged", () => {
    const links = assistLinks({ name: "Bella Nails", formattedAddress: null, websiteUrl: null, phone: "+17135550100" });
    expect(links.tel).toBe("tel:+17135550100");
  });

  it("tel is null when the phone is missing", () => {
    const links = assistLinks({ name: "Bella Nails", formattedAddress: null, websiteUrl: null, phone: null });
    expect(links.tel).toBeNull();
  });

  it("tel is null when the phone doesn't parse", () => {
    const links = assistLinks({ name: "Bella Nails", formattedAddress: null, websiteUrl: null, phone: "123" });
    expect(links.tel).toBeNull();
  });
});
