import { describe, it, expect, vi, afterEach } from "vitest";
import { BuiltinValidationProvider } from "@/lib/providers/validation";
import * as safeFetchMod from "@/lib/net/safeFetch";

function fakeBody() {
  // A real (small) stream: the discard path drains it to completion, so "released" means the
  // stream was fully read or cancelled — either way the socket can be reused/closed.
  const state = { drained: false, cancelled: false, get released() { return state.drained || state.cancelled; } };
  const stream = new ReadableStream<Uint8Array>({
    start(c) { c.enqueue(new Uint8Array(64)); c.close(); state.drained = true; },
    cancel() { state.cancelled = true; },
  });
  return Object.assign(state, { stream });
}

describe("BuiltinValidationProvider.checkWebsite body cancellation", () => {
  afterEach(() => vi.restoreAllMocks());

  it("cancels the body when the initial HEAD response is used directly", async () => {
    const body = fakeBody();
    vi.spyOn(safeFetchMod, "safeFetch").mockResolvedValueOnce({
      ok: false,
      status: 404,
      headers: new Headers(),
      body: body.stream,
    } as unknown as Response);
    const r = await new BuiltinValidationProvider().checkWebsite("https://x.com/");
    expect(r).toEqual({ reachable: false, error: "HTTP 404" });
    expect(body.released).toBe(true);
  });

  it("cancels the body on the GET fallback path (only the status is checked)", async () => {
    const headBody = fakeBody();
    const getBody = fakeBody();
    const spy = vi.spyOn(safeFetchMod, "safeFetch");
    spy.mockResolvedValueOnce({ ok: false, status: 405, headers: new Headers(), body: headBody.stream } as unknown as Response);
    spy.mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers(), body: getBody.stream } as unknown as Response);
    const r = await new BuiltinValidationProvider().checkWebsite("https://x.com/");
    expect(r).toEqual({ reachable: true });
    expect(getBody.released).toBe(true);
  });
});
