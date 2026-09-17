import { describe, it, expect } from "vitest";
import { withTimeout, TimeoutError, JobPausedError } from "@/lib/jobs/shared";

describe("withTimeout", () => {
  it("resolves when the promise settles in time", async () => {
    await expect(withTimeout(Promise.resolve(7), 1000, "x")).resolves.toBe(7);
  });
  it("rejects with TimeoutError when the promise hangs", async () => {
    const never = new Promise<number>(() => {});
    await expect(withTimeout(never, 20, "scrape https://hung.example")).rejects.toBeInstanceOf(TimeoutError);
    await expect(withTimeout(never, 20, "scrape https://hung.example")).rejects.toThrow(/hung\.example/);
  });
  it("passes other rejections through untouched", async () => {
    await expect(withTimeout(Promise.reject(new JobPausedError()), 1000, "x")).rejects.toBeInstanceOf(JobPausedError);
  });
});
