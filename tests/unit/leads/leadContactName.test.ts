import { describe, it, expect } from "vitest";
import { leadContactName } from "@/lib/leads/leadContactName";

describe("leadContactName", () => {
  it("primaryPerson leads when set, even when other named contacts exist", () => {
    expect(leadContactName({ primaryPerson: "Albert", contacts: [{ personName: "Someone Else" }] })).toBe("Albert");
  });

  it("falls back to the first named contact row when no primaryPerson is set", () => {
    expect(leadContactName({ primaryPerson: null, contacts: [{ personName: null }, { personName: "Lee" }, { personName: "Maria" }] })).toBe("Lee");
  });

  it("returns null when there is no primaryPerson and no named contact", () => {
    expect(leadContactName({ primaryPerson: null, contacts: [] })).toBeNull();
    expect(leadContactName({ primaryPerson: null, contacts: [{ personName: null }] })).toBeNull();
  });
});
