import { describe, it, expect } from "vitest";
import { createSessionToken, verifySessionToken } from "@/lib/session";

const secret = "0123456789abcdef0123456789abcdef";

describe("session tokens", () => {
  it("round-trips a signed token", async () => {
    const token = await createSessionToken(secret);
    const payload = await verifySessionToken(token, secret);
    expect(payload?.sub).toBe("local-user");
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await createSessionToken(secret);
    expect(await verifySessionToken(token, "another-secret-another-secret-1234")).toBeNull();
  });

  it("rejects garbage", async () => {
    expect(await verifySessionToken("not.a.token", secret)).toBeNull();
  });
});
