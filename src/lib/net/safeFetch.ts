import { assertSafeUrl, type Resolver } from "./ssrf";

export type SafeFetchOptions = { maxRedirects?: number; resolve?: Resolver; timeoutMs?: number; fetchImpl?: typeof fetch };

const REDIRECT = new Set([301, 302, 303, 307, 308]);

/** fetch with manual redirects; every hop must pass assertSafeUrl. */
export async function safeFetch(url: string, init: RequestInit = {}, opts: SafeFetchOptions = {}): Promise<Response> {
  const maxRedirects = opts.maxRedirects ?? 5;
  const f = opts.fetchImpl ?? fetch;
  let current = url;
  let method = init.method ?? "GET";
  let body = init.body;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const target = await assertSafeUrl(current, opts.resolve);
    const ctrl = new AbortController();
    const timer = opts.timeoutMs ? setTimeout(() => ctrl.abort(), opts.timeoutMs) : null;
    let res: Response;
    try {
      res = await f(target.href, { ...init, method, body, redirect: "manual", signal: init.signal ?? ctrl.signal });
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (!REDIRECT.has(res.status)) {
      // Expose the final URL for callers that read res.url (fetch fills it; test doubles may not).
      if (!res.url) {
        try {
          Object.defineProperty(res, "url", { value: target.href });
        } catch {
          // res.url is a read-only getter on a real Response; nothing to do.
        }
      }
      return res;
    }
    const loc = res.headers.get("location");
    if (!loc) return res;
    current = new URL(loc, target).href;
    if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === "POST")) {
      method = "GET";
      body = undefined;
    }
  }
  throw new Error(`too many redirects (> ${maxRedirects})`);
}

/** Reads at most maxBytes of the body (utf-8) and cancels the rest. */
export async function readCapped(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    const remaining = maxBytes - total;
    chunks.push(value.length > remaining ? value.subarray(0, remaining) : value);
    total += Math.min(value.length, remaining);
  }
  await reader.cancel().catch(() => {});
  return Buffer.concat(chunks).toString("utf8");
}
