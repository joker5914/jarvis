import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  mapSearchRow,
  fmtTdlrDate,
  workTypeFromCode,
  workTypeFromLabel,
  statusCodeFromLabel,
  TDLR_STATUS_LABELS,
  TDLR_STATUS_CODES,
  TDLR_WORK_TYPE_CODES,
} from "@/lib/providers/tdlr";

const sample = JSON.parse(readFileSync(path.join(import.meta.dirname, "../../fixtures/tdlr-search.json"), "utf8"));

describe("tdlr mappers", () => {
  it("maps a real search row", () => {
    const row = sample.data[0];
    const s = mapSearchRow(row);
    expect(s.projectNumber).toBe(row.ProjectNumber);
    expect(s.tdlrProjectId).toBe(row.ProjectId);
    expect(s.cityCode).toBe(785);
    expect(s.registeredAt.toISOString().slice(0, 10)).toBe(String(row.ProjectCreatedOn).slice(0, 10));
    expect(typeof s.statusCode).toBe("number");
    expect([9001, 9002, 9003, 9004, 9005]).toContain(s.workTypeCode);
    expect(s.estimatedCost === null || typeof s.estimatedCost === "number").toBe(true);
  });
  it("handles null dates and costs", () => {
    const s = mapSearchRow({
      ProjectId: "x", ProjectNumber: "TABS1", ProjectName: "N", ProjectCreatedOn: "2026-09-15T19:41:39.203",
      ProjectStatus: 3008, FacilityName: null, City: 785, County: 2101, TypeOfWork: 9002,
      EstimatedCost: null, DataVersionId: 900001, EstimatedStartDate: null, EstimatedEndDate: null,
    });
    expect(s.facilityName).toBeNull();
    expect(s.estimatedCost).toBeNull();
    expect(s.startDate).toBeNull();
    expect(s.completionDate).toBeNull();
  });
  it("formats dates and maps codes", () => {
    expect(fmtTdlrDate(new Date(Date.UTC(2026, 8, 5)))).toBe("09/05/2026");
    expect(workTypeFromCode(9001)).toBe("new_construction");
    expect(workTypeFromCode(9002)).toBe("renovation");
    expect(workTypeFromCode(9005)).toBe("row");
    expect(workTypeFromCode(1)).toBeNull();
    expect(workTypeFromLabel("Renovation/Alteration")).toBe("renovation");
    expect(workTypeFromLabel("Public Right of Way")).toBe("row");
    expect(TDLR_STATUS_LABELS[3007]).toBe("Project Closed");
  });

  it("inverts TDLR_STATUS_LABELS into TDLR_STATUS_CODES", () => {
    expect(TDLR_STATUS_CODES["project closed"]).toBe(3007);
    expect(TDLR_STATUS_CODES["inspection completed"]).toBe(3001);
    expect(Object.keys(TDLR_STATUS_CODES).length).toBe(Object.keys(TDLR_STATUS_LABELS).length);
  });

  it("statusCodeFromLabel is case-insensitive, trims, and special-cases the search dropdown wording", () => {
    expect(statusCodeFromLabel("Project Closed")).toBe(3007);
    expect(statusCodeFromLabel("  project closed  ")).toBe(3007);
    expect(statusCodeFromLabel("PROJECT CLOSED")).toBe(3007);
    expect(statusCodeFromLabel("Inspection Completed")).toBe(3001);
    // The search dropdown says "Inspection Complete" (no trailing "d"), distinct from the
    // detail page's "Inspection Completed".
    expect(statusCodeFromLabel("Inspection Complete")).toBe(3001);
    expect(statusCodeFromLabel("Not a real status")).toBeNull();
    expect(statusCodeFromLabel(null)).toBeNull();
    expect(statusCodeFromLabel(undefined)).toBeNull();
  });

  it("inverts TDLR_WORK_TYPES into TDLR_WORK_TYPE_CODES", () => {
    expect(TDLR_WORK_TYPE_CODES.new_construction).toBe(9001);
    expect(TDLR_WORK_TYPE_CODES.renovation).toBe(9002);
    expect(TDLR_WORK_TYPE_CODES.addition).toBe(9003);
    expect(TDLR_WORK_TYPE_CODES.historic).toBe(9004);
    expect(TDLR_WORK_TYPE_CODES.row).toBe(9005);
  });
});
