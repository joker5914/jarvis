import { describe, it, expect } from "vitest";
import { parseProjectFilters, buildProjectWhere, buildProjectOrderBy } from "@/lib/projects/filters";

describe("project filters", () => {
  it("defaults hide excluded and sort by completion", () => {
    const f = parseProjectFilters(new URLSearchParams(""));
    expect(f).toMatchObject({ showExcluded: false, page: 1, pageSize: 50, sort: "completion" });
    expect(buildProjectWhere(f, "u1")).toEqual({ ownerId: "u1", exclusion: "none" });
    expect(buildProjectOrderBy(f)).toEqual([{ completionDate: { sort: "asc", nulls: "last" } }, { smbFitScore: "desc" }]);
  });
  it("applies every filter", () => {
    const f = parseProjectFilters(new URLSearchParams("q=nails&zip=77084&workType=renovation&timing=opening_soon&fit=high&linked=false&showExcluded=true&sort=fit"));
    expect(buildProjectWhere(f, "u1")).toEqual({
      ownerId: "u1",
      OR: [{ projectName: { contains: "nails", mode: "insensitive" } }, { facilityName: { contains: "nails", mode: "insensitive" } }],
      zip: "77084",
      workType: "renovation",
      timingWindow: "opening_soon",
      smbFitScore: { gte: 60 },
      businessId: null,
    });
    expect(buildProjectOrderBy(f)).toEqual([{ smbFitScore: "desc" }, { completionDate: { sort: "asc", nulls: "last" } }]);
    expect(buildProjectWhere(parseProjectFilters(new URLSearchParams("fit=medium&linked=true")), "u1")).toMatchObject({
      smbFitScore: { gte: 30, lt: 60 },
      businessId: { not: null },
    });
    expect(buildProjectWhere(parseProjectFilters(new URLSearchParams("fit=low")), "u1")).toMatchObject({ smbFitScore: { lt: 30 } });
  });
  it("rejects bad enums", () => {
    expect(() => parseProjectFilters(new URLSearchParams("timing=soon"))).toThrow();
  });
});
