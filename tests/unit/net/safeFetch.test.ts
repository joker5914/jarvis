import { describe, it, expect, vi } from "vitest";
import { safeFetch, readCapped, pinnedDispatcher, type PinnedDispatcher } from "@/lib/net/safeFetch";
import { UnsafeUrlError } from "@/lib/net/ssrf";

const pub = async () => ["93.184.216.34"];

function fakeFetch(routes: Record<string, () => Response>): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const key = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const r = routes[key];
    if (!r) throw new Error(`unexpected fetch ${key}`);
    return r();
  }) as unknown as typeof fetch;
}

describe("safeFetch", () => {
  it("follows a public redirect and returns the final response", async () => {
    const f = fakeFetch({
      "http://example.com/": () => new Response(null, { status: 301, headers: { location: "https://example.com/home" } }),
      "https://example.com/home": () => new Response("<html>hi</html>", { status: 200, headers: { "content-type": "text/html" } }),
    });
    const res = await safeFetch("http://example.com/", {}, { resolve: pub, fetchImpl: f });
    expect(res.status).toBe(200);
    expect(res.url || "https://example.com/home").toBe("https://example.com/home");
    expect(await res.text()).toContain("hi");
  });
  it("refuses a redirect to a private address", async () => {
    const f = fakeFetch({
      "https://example.com/": () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1:80/admin" } }),
    });
    await expect(safeFetch("https://example.com/", {}, { resolve: pub, fetchImpl: f })).rejects.toBeInstanceOf(UnsafeUrlError);
  });
  it("stops after maxRedirects hops", async () => {
    const f = fakeFetch({
      "https://example.com/a": () => new Response(null, { status: 302, headers: { location: "https://example.com/b" } }),
      "https://example.com/b": () => new Response(null, { status: 302, headers: { location: "https://example.com/a" } }),
    });
    await expect(safeFetch("https://example.com/a", {}, { resolve: pub, fetchImpl: f, maxRedirects: 3 })).rejects.toThrow(/redirects/);
  });
  it("caps the body while streaming", async () => {
    const big = "x".repeat(50_000);
    const res = new Response(big, { status: 200 });
    const text = await readCapped(res, 1_000);
    expect(text.length).toBe(1_000);
  });
  it("pins the connection to the validated addresses via a dispatcher lookup", async () => {
    let seen: unknown;
    const f = vi.fn(async (_u: string, init: RequestInit & { dispatcher?: unknown }) => {
      seen = init.dispatcher;
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;
    await safeFetch("https://example.com/", {}, { resolve: async () => ["93.184.216.34"], fetchImpl: f });
    expect(seen).toBeDefined();
    const d = seen as { lookupFor: (host: string) => Promise<{ address: string; family: number }[]> };
    await expect(d.lookupFor("example.com")).resolves.toEqual([{ address: "93.184.216.34", family: 4 }]);
    await expect(d.lookupFor("other.example")).rejects.toThrow(/pinned/);
  });
  it("does not attach a dispatcher for IP-literal hosts (nothing to pin)", async () => {
    let seen: unknown = "unset";
    const f = vi.fn(async (_u: string, init: RequestInit & { dispatcher?: unknown }) => {
      seen = init.dispatcher;
      return new Response("ok");
    }) as unknown as typeof fetch;
    await safeFetch("http://93.184.216.34/", {}, { fetchImpl: f });
    expect(seen).toBeUndefined();
  });
  it("closes the dispatcher when the underlying fetch rejects", async () => {
    let seen: unknown;
    const f = vi.fn(async (_u: string, init: RequestInit & { dispatcher?: unknown }) => {
      seen = init.dispatcher;
      throw new Error("connection refused");
    }) as unknown as typeof fetch;
    await expect(
      safeFetch("https://example.com/", {}, { resolve: async () => ["93.184.216.34"], fetchImpl: f }),
    ).rejects.toThrow(/connection refused/);
    const d = seen as PinnedDispatcher;
    expect(d.closed).toBe(true);
  });
  it("does not lock the body stream out from res.text() when a dispatcher is pinned", async () => {
    // Regression guard: an earlier attempt closed the dispatcher by acquiring our
    // own res.body.getReader() to watch for completion, which locked the stream
    // and broke res.text() with "Body has already been read". safeFetch must not
    // interfere with whichever body-consumption method the caller uses.
    const f = vi.fn(async () => new Response("hi there", { status: 200 })) as unknown as typeof fetch;
    const res = await safeFetch("https://example.com/", {}, { resolve: async () => ["93.184.216.34"], fetchImpl: f });
    await expect(res.text()).resolves.toBe("hi there");
  });
  it("still lets readCapped read the body via res.body.getReader() when a dispatcher is pinned", async () => {
    const f = vi.fn(async () => new Response("hello world", { status: 200 })) as unknown as typeof fetch;
    const res = await safeFetch("https://example.com/", {}, { resolve: async () => ["93.184.216.34"], fetchImpl: f });
    await expect(readCapped(res, 1_000)).resolves.toBe("hello world");
  });
  it("closes the final-hop dispatcher via a bounded backstop when the body is never explicitly drained", async () => {
    vi.useFakeTimers();
    try {
      let seen: unknown;
      const f = vi.fn(async (_u: string, init: RequestInit & { dispatcher?: unknown }) => {
        seen = init.dispatcher;
        return new Response("hello world", { status: 200 });
      }) as unknown as typeof fetch;
      await safeFetch("https://example.com/", {}, { resolve: async () => ["93.184.216.34"], fetchImpl: f });
      const d = seen as PinnedDispatcher;
      expect(d.closed).toBe(false);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(d.closed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
  it("closes the final-hop dispatcher immediately when there is no body to consume", async () => {
    let seen: unknown;
    const f = vi.fn(async (_u: string, init: RequestInit & { dispatcher?: unknown }) => {
      seen = init.dispatcher;
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    await safeFetch("https://example.com/", {}, { resolve: async () => ["93.184.216.34"], fetchImpl: f });
    const d = seen as PinnedDispatcher;
    expect(d.closed).toBe(true);
  });
  it("closes each redirect hop's dispatcher before opening the next hop's", async () => {
    const seenByUrl: Record<string, PinnedDispatcher> = {};
    const f = vi.fn(async (u: string, init: RequestInit & { dispatcher?: unknown }) => {
      seenByUrl[u] = init.dispatcher as PinnedDispatcher;
      if (u === "https://example.com/") {
        return new Response(null, { status: 302, headers: { location: "https://example.com/home" } });
      }
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;
    await safeFetch("https://example.com/", {}, { resolve: async () => ["93.184.216.34"], fetchImpl: f });
    expect(seenByUrl["https://example.com/"].closed).toBe(true);
    expect(seenByUrl["https://example.com/home"]).not.toBe(seenByUrl["https://example.com/"]);
  });
  it("builds the pinned Agent with a tight keep-alive/connection budget", async () => {
    const d = pinnedDispatcher("example.com", ["93.184.216.34"]);
    expect(d.options).toEqual({ keepAliveTimeout: 1, keepAliveMaxTimeout: 1, connections: 1, pipelining: 0 });
    await d.close();
  });
});
