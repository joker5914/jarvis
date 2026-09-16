import { describe, it, expect } from "vitest";
import { scoreContactQuality } from "@/lib/scoring/contactQuality";

describe("scoreContactQuality", () => {
  it("returns red with nothing", () => {
    const r = scoreContactQuality({ websiteReachable: null, phone: null, contacts: [] });
    expect(r.score).toBe(0);
    expect(r.band).toBe("red");
  });

  it("scores website + phone + valid email as green", () => {
    const r = scoreContactQuality({
      websiteReachable: true,
      phone: "(713) 555-0100",
      contacts: [{ type: "email", validationStatus: "valid" }],
    });
    expect(r.score).toBe(75);
    expect(r.band).toBe("green");
    expect(r.reasons.map((x) => x.code)).toEqual(["website_reachable", "phone", "email_valid_mx"]);
  });

  it("ignores emails whose domain has no MX", () => {
    const r = scoreContactQuality({
      websiteReachable: false,
      phone: null,
      contacts: [{ type: "email", validationStatus: "invalid" }],
    });
    expect(r.score).toBe(0);
  });

  it("counts a named person with title and a social link", () => {
    const r = scoreContactQuality({
      websiteReachable: false,
      phone: "not a phone",
      contacts: [
        { type: "linkedin", validationStatus: "unchecked", personName: "Ana Ruiz", personTitle: "Owner" },
        { type: "facebook", validationStatus: "unchecked" },
      ],
    });
    expect(r.score).toBe(25);
    expect(r.band).toBe("red");
  });

  it("accepts a valid phone contact when the Google phone is missing", () => {
    const r = scoreContactQuality({
      websiteReachable: null,
      phone: null,
      contacts: [{ type: "phone", validationStatus: "valid" }],
    });
    expect(r.score).toBe(20);
  });
});
