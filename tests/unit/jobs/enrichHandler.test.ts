import { describe, it, expect, vi } from "vitest";
import { handleEnrichJob } from "@/lib/jobs/enrichHandler";
import { BudgetExhaustedError } from "@/lib/providers/budget";
import { ProviderDisabledError, ProviderNotConfiguredError, ProviderPlanError } from "@/lib/providers/errors";

const deps = { providers: {} as never, log: () => {} };
const data = { businessId: "b1", ownerId: "o1" };

describe("handleEnrichJob", () => {
  it("returns done on success", async () => {
    expect(await handleEnrichJob(data, deps, async () => ({ added: 1, updated: 0, skipped: null }))).toEqual({ result: "done" });
  });
  it.each([new BudgetExhaustedError("apollo"), new ProviderNotConfiguredError("apollo"), new ProviderDisabledError("apollo"), new ProviderPlanError("apollo", "/mixed_people/api_search", "API_INACCESSIBLE")])("swallows %s as skipped, with its message as the reason", async (err) => {
    expect(await handleEnrichJob(data, deps, async () => { throw err; })).toEqual({ result: "skipped", reason: err.message });
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
