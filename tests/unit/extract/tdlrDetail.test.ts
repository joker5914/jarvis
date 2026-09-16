import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseTdlrDetail, parseTdlrDate, parseMoney, parseSqft, parseAddressLines } from "@/lib/extract/tdlrDetail";

const html = readFileSync(path.join(import.meta.dirname, "../../fixtures/html/tdlr-detail.html"), "utf8");

describe("field parsers", () => {
  it("parses M/D/YYYY dates as UTC midnight", () => {
    expect(parseTdlrDate("1/20/2026")?.toISOString()).toBe("2026-01-20T00:00:00.000Z");
    expect(parseTdlrDate("")).toBeNull();
    expect(parseTdlrDate("nope")).toBeNull();
  });
  it("parses money and square footage", () => {
    expect(parseMoney("$60,000")).toBe(60000);
    expect(parseMoney("$1,705,000.50")).toBe(1705000.5);
    expect(parseMoney(null)).toBeNull();
    expect(parseSqft("3,175 ft 2")).toBe(3175);
    expect(parseSqft("3,175 ft2")).toBe(3175);
    expect(parseSqft(undefined)).toBeNull();
  });
  it("splits address lines into street, city, state, zip", () => {
    expect(parseAddressLines(["6031 Highway 6 N SUite #190", "Houston, TX 77084"])).toEqual({
      address: "6031 Highway 6 N SUite #190", city: "Houston", state: "TX", zip: "77084",
    });
    expect(parseAddressLines(["6031 Highway 6 North #190", "Houston, Texas 77084"])).toEqual({
      address: "6031 Highway 6 North #190", city: "Houston", state: "TX", zip: "77084",
    });
    expect(parseAddressLines([])).toEqual({ address: null, city: null, state: null, zip: null });
  });
});

describe("parseTdlrDetail", () => {
  it("extracts every field from a real detail page", () => {
    const d = parseTdlrDetail(html);
    expect(d.projectNumber).toBe("TABS2027001089");
    expect(d.projectName).toBe("La Dulce Vida Adult Day Care");
    expect(d.facilityName).toBe("La Dulce Vida Adult Day Car");
    expect(d.locationAddress).toBe("6031 Highway 6 N SUite #190");
    expect(d.city).toBe("Houston");
    expect(d.state).toBe("TX");
    expect(d.zip).toBe("77084");
    expect(d.county).toBe("Harris");
    expect(d.startDate?.toISOString()).toBe("2025-08-20T00:00:00.000Z");
    expect(d.completionDate?.toISOString()).toBe("2026-01-20T00:00:00.000Z");
    expect(d.estimatedCost).toBe(60000);
    expect(d.workTypeLabel).toBe("Renovation/Alteration");
    expect(d.fundsType).toMatch(/privately funded/);
    expect(d.scopeOfWork).toBe("Adult Day Care renovations, floor, roof, walls");
    expect(d.squareFootage).toBe(3175);
    expect(d.tenantFunded).toBe(true);
    expect(d.statusLabel).toBe("Project Registered");
    expect(d.registrationDate?.toISOString()).toBe("2026-09-15T00:00:00.000Z");
    expect(d.contactName).toBe("Iris Regueira");
    expect(d.rasName).toBe("LARRY T,FLEMING");
    expect(d.rasPhone).toBe("(281) 745-0234");
    expect(d.ownerName).toBe("Irisnexy Regueira");
    expect(d.ownerAddress).toBe("6031 Highway 6 North #190, Houston, Texas 77084");
    expect(d.ownerPhone).toBe("(713) 340-7247");
    expect(d.tenantName).toBeNull();
    expect(d.designFirmName).toBeNull();
  });

  it("does not throw on an empty page and returns nulls", () => {
    const d = parseTdlrDetail("<html><body></body></html>");
    expect(d.projectNumber).toBe("");
    expect(d.projectName).toBeNull();
    expect(d.ownerPhone).toBeNull();
  });
});
