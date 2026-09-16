import { describe, it, expect, vi } from "vitest";
import { safeFetch, readCapped } from "@/lib/net/safeFetch";
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
});
