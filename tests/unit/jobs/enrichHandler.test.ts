import { describe, it, expect, vi } from "vitest";
import { handleEnrichJob } from "@/lib/jobs/enrichHandler";
import { BudgetExhaustedError } from "@/lib/providers/budget";
import { ProviderDisabledError, ProviderNotConfiguredError } from "@/lib/providers/errors";

const deps = { providers: {} as never, log: () => {} };
const data = { businessId: "b1", ownerId: "o1" };

describe("handleEnrichJob", () => {
  it("returns done on success", async () => {
    expect(await handleEnrichJob(data, deps, async () => ({ added: 1, updated: 0, skipped: null }))).toBe("done");
  });
  it.each([new BudgetExhaustedError("apollo"), new ProviderNotConfiguredError("apollo"), new ProviderDisabledError("apollo")])("swallows %s as skipped", async (err) => {
    expect(await handleEnrichJob(data, deps, async () => { throw err; })).toBe("skipped");
  });
  it("rethrows other errors so pg-boss retries", async () => {
    await expect(handleEnrichJob(data, deps, async () => { throw new Error("network"); })).rejects.toThrow("network");
  });
  it("passes force through", async () => {
    const run = vi.fn(async () => ({ added: 0, updated: 0, skipped: null }));
    await handleEnrichJob({ ...data, force: true }, deps, run);
    expect(run).toHaveBeenCalledWith("b1", "o1", deps, { force: true });
  });
});
