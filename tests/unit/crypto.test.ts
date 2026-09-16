import { describe, it, expect } from "vitest";
import { encryptString, decryptString } from "@/lib/crypto";

const secret = "a-very-long-app-secret-for-testing-1234567890";

describe("crypto", () => {
  it("round-trips", () => {
    const c = encryptString("AIza-secret-key", secret);
    expect(c).not.toContain("AIza");
    expect(decryptString(c, secret)).toBe("AIza-secret-key");
  });
  it("produces different ciphertexts for the same input", () => {
    expect(encryptString("x", secret)).not.toBe(encryptString("x", secret));
  });
  it("fails with the wrong secret", () => {
    const c = encryptString("x", secret);
    expect(() => decryptString(c, "wrong-secret-wrong-secret-wrong-secret")).toThrow();
  });
});
