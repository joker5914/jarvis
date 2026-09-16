import { describe, it, expect } from "vitest";
import { parseLeadFilters, buildBusinessWhere, buildBusinessOrderBy } from "@/lib/leads/filters";

describe("parseLeadFilters", () => {
  it("applies defaults", () => {
    const f = parseLeadFilters(new URLSearchParams(""));
    expect(f).toMatchObject({ showExcluded: false, page: 1, pageSize: 50, sort: "quality" });
  });
  it("parses values and rejects bad enums", () => {
    const f = parseLeadFilters(new URLSearchParams("q=nails&quality=green&status=contacted&showExcluded=true&page=2"));
    expect(f).toMatchObject({ q: "nails", quality: "green", status: "contacted", showExcluded: true, page: 2 });
    expect(() => parseLeadFilters(new URLSearchParams("quality=purple"))).toThrow();
  });
});

describe("buildBusinessWhere", () => {
  it("hides excluded by default and scopes to owner", () => {
    const w = buildBusinessWhere(parseLeadFilters(new URLSearchParams("")), "u1");
    expect(w).toEqual({ ownerId: "u1", exclusion: "none" });
  });
  it("adds each filter", () => {
    const w = buildBusinessWhere(
      parseLeadFilters(new URLSearchParams("q=bella&category=nail_salon&zip=77084&source=zip_search&quality=green&status=contacted&tag=hot&product=mobile&searchId=s1&showExcluded=true")),
      "u1",
    );
    expect(w).toEqual({
      ownerId: "u1",
      name: { contains: "bella", mode: "insensitive" },
      primaryCategory: "nail_salon",
      zip: "77084",
      source: "zip_search",
      contactQualityBand: "green",
      outreachStatus: "contacted",
      tags: { some: { tag: { name: "hot" } } },
      productsPitched: { has: "mobile" },
      searches: { some: { searchId: "s1" } },
    });
  });
  it("filters by a linked project's timing window", () => {
    const w = buildBusinessWhere(parseLeadFilters(new URLSearchParams("timing=opening_soon")), "u1");
    expect(w).toEqual({ ownerId: "u1", exclusion: "none", projects: { some: { timingWindow: "opening_soon" } } });
    expect(() => parseLeadFilters(new URLSearchParams("timing=never"))).toThrow();
  });
});

describe("buildBusinessOrderBy", () => {
  it("sorts by quality then name by default", () => {
    expect(buildBusinessOrderBy(parseLeadFilters(new URLSearchParams("")))).toEqual([
      { contactQualityScore: "desc" },
      { name: "asc" },
    ]);
    expect(buildBusinessOrderBy(parseLeadFilters(new URLSearchParams("sort=updated")))).toEqual([{ updatedAt: "desc" }]);
  });
});
