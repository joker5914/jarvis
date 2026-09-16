import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ensureQueue } from "@/lib/jobs/queues";

function fakeBoss(existingPolicy: string | undefined) {
  const calls = { createQueue: 0, deleteQueue: 0 };
  return {
    calls,
    boss: {
      createQueue: async () => {
        calls.createQueue++;
      },
      getQueues: async () => (existingPolicy === undefined ? [] : [{ name: "q", policy: existingPolicy }]),
      deleteQueue: async () => {
        calls.deleteQueue++;
      },
    },
  };
}

describe("ensureQueue (R3: NODE_ENV gate)", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    warn.mockRestore();
  });

  it("does nothing when the queue doesn't exist yet, regardless of NODE_ENV", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PGBOSS_RECREATE_QUEUES", undefined);
    const { boss, calls } = fakeBoss(undefined);
    await ensureQueue(boss, "zip-search", { expireInSeconds: 1, policy: "stately" });
    expect(calls.createQueue).toBe(1);
    expect(calls.deleteQueue).toBe(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it("does nothing when the existing policy already matches", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PGBOSS_RECREATE_QUEUES", undefined);
    const { boss, calls } = fakeBoss("stately");
    await ensureQueue(boss, "zip-search", { expireInSeconds: 1, policy: "stately" });
    expect(calls.deleteQueue).toBe(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it("recreates when NODE_ENV is development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("PGBOSS_RECREATE_QUEUES", undefined);
    const { boss, calls } = fakeBoss("standard");
    await ensureQueue(boss, "zip-search", { expireInSeconds: 1, policy: "stately" });
    expect(calls.deleteQueue).toBe(1);
    expect(calls.createQueue).toBe(2); // once up front, once after delete
  });

  it("recreates when NODE_ENV is test", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("PGBOSS_RECREATE_QUEUES", undefined);
    const { boss, calls } = fakeBoss("standard");
    await ensureQueue(boss, "zip-search", { expireInSeconds: 1, policy: "stately" });
    expect(calls.deleteQueue).toBe(1);
  });

  it("recreates when PGBOSS_RECREATE_QUEUES=1, even under NODE_ENV=production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PGBOSS_RECREATE_QUEUES", "1");
    const { boss, calls } = fakeBoss("standard");
    await ensureQueue(boss, "zip-search", { expireInSeconds: 1, policy: "stately" });
    expect(calls.deleteQueue).toBe(1);
  });

  it("only warns — never recreates — when NODE_ENV is unset (e.g. a bare `node` worker with no NODE_ENV), preventing R3's silent-delete-on-first-boot bug", async () => {
    vi.stubEnv("NODE_ENV", undefined);
    vi.stubEnv("PGBOSS_RECREATE_QUEUES", undefined);
    const { boss, calls } = fakeBoss("standard");
    await ensureQueue(boss, "zip-search", { expireInSeconds: 1, policy: "stately" });
    expect(calls.deleteQueue).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("only warns under NODE_ENV=production with no opt-in flag", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PGBOSS_RECREATE_QUEUES", undefined);
    const { boss, calls } = fakeBoss("standard");
    await ensureQueue(boss, "zip-search", { expireInSeconds: 1, policy: "stately" });
    expect(calls.deleteQueue).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
