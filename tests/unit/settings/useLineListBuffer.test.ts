import { describe, it, expect } from "vitest";
import { nextBufferState } from "@/components/settings/useLineListBuffer";

// @testing-library/react is not a project dependency (checked package.json), so this exercises
// the pure reducer that `useLineListBuffer` wraps in a `useState`/`useRef` shell, per M1: the
// buffer must not resync on the component's own edit (only a mismatch against what was last sent
// upward is a genuine external change), or a keystroke that produces a content-identical-looking
// round trip -- a space or a blank line -- gets silently swallowed.
describe("nextBufferState", () => {
  it("keeps the in-progress buffer when the incoming list matches what was last sent", () => {
    // Mid-keystroke: the user just typed a trailing space after "general manager", so the raw
    // buffer differs from the parsed list, but the parsed list already round-tripped back as
    // `incomingList` unchanged (matches lastSent) -- the buffer (with the space) must survive.
    const prev = "owner\ngeneral manager ";
    const lastSent = "owner\ngeneral manager";
    const incomingList = ["owner", "general manager"];
    expect(nextBufferState(prev, incomingList, lastSent)).toBe(prev);
  });

  it("keeps the in-progress buffer across a trailing blank line", () => {
    const prev = "owner\n\n";
    const lastSent = "owner";
    const incomingList = ["owner"];
    expect(nextBufferState(prev, incomingList, lastSent)).toBe(prev);
  });

  it("resyncs when the incoming list genuinely differs from what was last sent (external change)", () => {
    const prev = "owner\nfounder";
    const lastSent = "owner\nfounder";
    const incomingList = ["owner", "vp"]; // e.g. a reload after save, or another tab's edit
    expect(nextBufferState(prev, incomingList, lastSent)).toBe("owner\nvp");
  });

  it("resyncs on first mount when nothing has been sent yet and the list is non-empty", () => {
    const prev = "";
    const lastSent = "";
    const incomingList = ["owner"];
    expect(nextBufferState(prev, incomingList, lastSent)).toBe("owner");
  });

  it("is a no-op when both the incoming list and lastSent are empty", () => {
    expect(nextBufferState("", [], "")).toBe("");
  });
});
