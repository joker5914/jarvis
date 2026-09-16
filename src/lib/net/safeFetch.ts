import { isIP } from "node:net";
import { Agent, fetch as undiciFetch, type Dispatcher } from "undici";
import { assertSafeUrl, type Resolver } from "./ssrf";

export type SafeFetchOptions = { maxRedirects?: number; resolve?: Resolver; timeoutMs?: number; fetchImpl?: typeof fetch };

const REDIRECT = new Set([301, 302, 303, 307, 308]);

export type PinnedDispatcher = Dispatcher & { lookupFor: (h: string) => Promise<{ address: string; family: number }[]> };

/**
 * An undici Agent whose DNS lookup answers only for the one hostname it was
 * built for, with the exact addresses assertSafeUrl already validated as
 * public. This is what makes the connection go to the address that was
 * checked rather than whatever a fresh (possibly rebound) DNS answer would
 * give at connect time: undici's connector calls this lookup instead of the
 * OS resolver, so a same-TTL DNS-rebinding attacker who flips the record
 * between our validation and the actual TCP connect cannot redirect the
 * socket to a private address.
 */
export function pinnedDispatcher(hostname: string, addresses: string[]): PinnedDispatcher {
  const answer = addresses.map((address) => ({ address, family: isIP(address) === 6 ? 6 : 4 }));
  const lookupFor = async (h: string) => {
    if (h.toLowerCase() !== hostname.toLowerCase()) throw new Error(`pinned dispatcher refused lookup for ${h}`);
    return answer;
  };
  const agent = new Agent({
    connect: {
      lookup: (h, opts, cb) => {
        lookupFor(h).then(
          (list) => {
            if (opts && (opts as { all?: boolean }).all) {
              cb(null, list as never);
            } else {
              const first = list[0];
              cb(null, first?.address ?? "", first?.family);
            }
          },
          (e) => cb(e as Error, [] as never),
        );
      },
    },
  });
  return Object.assign(agent, { lookupFor });
}

/** fetch with manual redirects; every hop must pass assertSafeUrl and connects only to its validated address. */
export async function safeFetch(url: string, init: RequestInit = {}, opts: SafeFetchOptions = {}): Promise<Response> {
  const maxRedirects = opts.maxRedirects ?? 5;
  const f = opts.fetchImpl ?? (undiciFetch as unknown as typeof fetch);
  let current = url;
  let method = init.method ?? "GET";
  let body = init.body;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const { url: target, addresses } = await assertSafeUrl(current, opts.resolve);
    // IP-literal hosts have nothing to pin: there was no DNS resolution to rebind.
    const dispatcher = addresses.length ? pinnedDispatcher(target.hostname, addresses) : undefined;
    const ctrl = new AbortController();
    const timer = opts.timeoutMs ? setTimeout(() => ctrl.abort(), opts.timeoutMs) : null;
    let res: Response;
    try {
      res = await f(target.href, {
        ...init,
        method,
        body,
        redirect: "manual",
        signal: init.signal ?? ctrl.signal,
        ...(dispatcher ? { dispatcher } : {}),
      } as RequestInit);
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
      // Final hop: the caller (readCapped or a direct res.text()/.json()) still needs
      // to read the body over this dispatcher's connection, so it is deliberately left
      // open here. undici recycles/closes idle keep-alive sockets on its own timers,
      // and the Agent itself becomes unreferenced once the response and this function's
      // local `dispatcher` binding go out of scope, so GC reclaims it; there is no
      // handle leak to close explicitly.
      return res;
    }
    const loc = res.headers.get("location");
    // A redirect response carries no body we return to the caller, so this hop's
    // connection is done as soon as we've read the status/headers: close it now
    // rather than waiting on GC, since we're about to open a fresh (re-resolved,
    // re-pinned) dispatcher for the next hop.
    if (dispatcher) await dispatcher.close().catch(() => {});
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
