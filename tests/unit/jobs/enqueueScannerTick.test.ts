import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { runScannerTick } = vi.hoisted(() => ({ runScannerTick: vi.fn(async () => ({ status: "idle" as const, work: null })) }));
vi.mock("@/lib/scanner/tick", () => ({ runScannerTick }));

const { enqueueScannerTick } = await import("@/lib/jobs/enqueue");

describe("enqueueScannerTick inline in-flight guard (F6)", () => {
  const prevMode = process.env.JOB_MODE;

  beforeEach(() => {
    process.env.JOB_MODE = "inline";
    runScannerTick.mockClear();
  });
  afterEach(() => {
    process.env.JOB_MODE = prevMode;
  });

  it("shares one running tick promise across concurrent inline calls; the second returns false", async () => {
    let resolveTick!: () => void;
    runScannerTick.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveTick = () => resolve({ status: "idle", work: null });
        }),
    );

    const [a, b] = await Promise.all([enqueueScannerTick(), enqueueScannerTick()]);

    expect([a, b].sort()).toEqual([false, true]);
    // enqueueScannerTick's inline branch resolves `true`/`false` synchronously (before its own
    // dynamic import of scanner/tick settles), so give that import + the tick call itself a
    // few more microtask turns to actually happen before asserting the call count.
    await vi.waitFor(() => expect(runScannerTick).toHaveBeenCalledTimes(1));

    resolveTick();
  });

  it("allows a new tick once the previous inline tick has finished", async () => {
    expect(await enqueueScannerTick()).toBe(true);
    await vi.waitFor(() => expect(runScannerTick).toHaveBeenCalledTimes(1));
    // The in-flight guard clears asynchronously (in a `.finally` after the tick settles), so
    // retry the second call until it lands after that clears rather than a fixed number of
    // microtask turns.
    await vi.waitFor(async () => {
      expect(await enqueueScannerTick()).toBe(true);
    });
    // As in the first test: a `true` return only means a new tick was accepted, not that the
    // mock has actually been invoked yet (that happens after its own dynamic-import chain).
    await vi.waitFor(() => expect(runScannerTick).toHaveBeenCalledTimes(2));
  });
});
