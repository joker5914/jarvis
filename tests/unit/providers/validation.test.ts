import { describe, it, expect, vi, afterEach } from "vitest";
import { BuiltinValidationProvider } from "@/lib/providers/validation";
import * as safeFetchMod from "@/lib/net/safeFetch";

function fakeBody() {
  const body = { cancelled: false, cancel: async () => { body.cancelled = true; } };
  return body;
}

describe("BuiltinValidationProvider.checkWebsite body cancellation", () => {
  afterEach(() => vi.restoreAllMocks());

  it("cancels the body when the initial HEAD response is used directly", async () => {
    const body = fakeBody();
    vi.spyOn(safeFetchMod, "safeFetch").mockResolvedValueOnce({
      ok: false,
      status: 404,
      headers: new Headers(),
      body,
    } as unknown as Response);
    const r = await new BuiltinValidationProvider().checkWebsite("https://x.com/");
    expect(r).toEqual({ reachable: false, error: "HTTP 404" });
    expect(body.cancelled).toBe(true);
  });

  it("cancels the body on the GET fallback path (only the status is checked)", async () => {
    const headBody = fakeBody();
    const getBody = fakeBody();
    const spy = vi.spyOn(safeFetchMod, "safeFetch");
    spy.mockResolvedValueOnce({ ok: false, status: 405, headers: new Headers(), body: headBody } as unknown as Response);
    spy.mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers(), body: getBody } as unknown as Response);
    const r = await new BuiltinValidationProvider().checkWebsite("https://x.com/");
    expect(r).toEqual({ reachable: true });
    expect(getBody.cancelled).toBe(true);
  });
});
