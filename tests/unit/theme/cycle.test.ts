import { describe, it, expect } from "vitest";
import { nextTheme } from "@/lib/theme/cycle";

describe("nextTheme", () => {
  it("cycles light -> dark -> system -> light", () => {
    expect(nextTheme("light")).toBe("dark");
    expect(nextTheme("dark")).toBe("system");
    expect(nextTheme("system")).toBe("light");
  });

  it("treats an unrecognized or undefined current theme as starting the cycle (-> light)", () => {
    expect(nextTheme(undefined)).toBe("light");
    expect(nextTheme("not-a-theme")).toBe("light");
  });
});
