import { describe, it, expect } from "vitest";
import { US_STATE_NAMES, stateNameFor } from "@/lib/geo/usStates";

describe("US_STATE_NAMES", () => {
  it("has the 50 states plus DC (51 entries)", () => {
    expect(Object.keys(US_STATE_NAMES)).toHaveLength(51);
  });
});

describe("stateNameFor", () => {
  it.each([
    ["TX", "Texas"],
    ["tx", "Texas"],
    ["XX", null],
    [null, null],
    [undefined, null],
  ])("%s → %s", (input, out) => expect(stateNameFor(input)).toBe(out));
});
