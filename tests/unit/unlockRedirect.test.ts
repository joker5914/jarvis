import { describe, it, expect } from "vitest";
import { safeRedirectPath } from "@/lib/session";

describe("safeRedirectPath", () => {
  it("allows safe local paths", () => {
    expect(safeRedirectPath("/leads")).toBe("/leads");
  });

  it("rejects protocol-relative URLs", () => {
    expect(safeRedirectPath("//evil.com")).toBe("/");
  });

  it("rejects backslash escapes", () => {
    expect(safeRedirectPath("/\\evil.com")).toBe("/");
  });

  it("rejects absolute URLs", () => {
    expect(safeRedirectPath("https://evil.com")).toBe("/");
  });

  it("rejects empty strings", () => {
    expect(safeRedirectPath("")).toBe("/");
  });
});
