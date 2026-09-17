import { isIP } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";
import { assertSafeUrl, type Resolver } from "./ssrf";

export type SafeFetchOptions = { maxRedirects?: number; resolve?: Resolver; timeoutMs?: number; fetchImpl?: typeof fetch };

const REDIRECT = new Set([301, 302, 303, 307, 308]);

// A single pinned dispatcher exists for exactly one hop's one request: no benefit to
// pipelining or keeping a socket warm, and every millisecond it might idle after we
// forget to (or cannot) close it explicitly is a millisecond a leaked Agent could be
// reused for something it was never validated for. Keeping these at their tightest
// legal values (undici requires keepAliveTimeout/keepAliveMaxTimeout > 0) means an
// unclosed dispatcher's socket is evicted by undici's own timers almost immediately,
// independent of the explicit-close logic in safeFetch below.
const PINNED_DISPATCHER_OPTIONS = {
  keepAliveTimeout: 1,
  keepAliveMaxTimeout: 1,
  connections: 1,
  pipelining: 0,
} as const;

export type PinnedDispatcher = Agent & {
  lookupFor: (h: string) => Promise<{ address: string; family: number }[]>;
  options: typeof PINNED_DISPATCHER_OPTIONS;
};

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
    ...PINNED_DISPATCHER_OPTIONS,
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
  return Object.assign(agent, { lookupFor, options: PINNED_DISPATCHER_OPTIONS });
}

const DISPATCHER_CLOSE_BACKSTOP_MS = 30_000;

/**
 * Closes `dispatcher` for the final hop's response. If there is no body at
 * all (e.g. a HEAD response), there is nothing to wait for, so we close now.
 *
 * Otherwise we deliberately do *not* try to observe "the body has been fully
 * read" by acquiring our own `res.body.getReader()`: a stream can only ever
 * be locked by one reader, and grabbing one here to watch for completion
 * would starve any caller that instead consumes the response via
 * `res.text()`/`res.json()`/`res.arrayBuffer()` (those need their own
 * internal reader on that same stream, and fail with "Body has already been
 * read" once we've taken it) or via a fresh `res.body.getReader()` of their
 * own (which would throw "ReadableStream is locked"). safeFetch's own tests
 * exercise both `res.text()` and `readCapped`'s `res.body.getReader()`
 * against its return value, so both must keep working. Instead, a bounded
 * backstop timer closes the dispatcher later. This is not a security
 * weakening: PINNED_DISPATCHER_OPTIONS already gives this Agent a 1ms
 * keepAliveTimeout, so undici itself evicts the idle socket almost
 * immediately once the response is drained, regardless of when this backstop
 * gets around to closing the (by then inert) Agent object. The backstop's
 * only job is to reclaim that Agent handle within a bounded time instead of
 * waiting on GC.
 */
function closeDispatcherWithBody(res: Response, dispatcher: PinnedDispatcher): void {
  if (!res.body) {
    void dispatcher.close().catch(() => {});
    return;
  }
  setTimeout(() => void dispatcher.close().catch(() => {}), DISPATCHER_CLOSE_BACKSTOP_MS).unref?.();
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
    } catch (e) {
      // The fetch itself failed (timeout abort, connection refused, TLS failure, ...):
      // the dispatcher's Agent was never handed back to a caller, so nobody else will
      // ever close it. Close it here before propagating the error.
      if (dispatcher) await dispatcher.close().catch(() => {});
      throw e;
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
      // Final hop: the caller (readCapped, or a direct res.text()/.json()) still needs
      // to read the body, so the dispatcher can't be closed synchronously here — see
      // closeDispatcherWithBody for why it's closed on a bounded backstop instead.
      if (dispatcher) closeDispatcherWithBody(res, dispatcher);
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
/**
 * After the cap is reached, keep reading (and discarding) up to this many more bytes before
 * cancelling. undici's HTTP/1 parser asserts `!paused` in `Parser.finish()` when the server
 * closes a non-keep-alive connection while the consumer has stopped pulling (seen live: a
 * capped page + `Connection: close` crashed the worker with `AssertionError: false == true`).
 * Draining a bounded remainder lets most responses reach EOF with the parser unpaused; only
 * pathologically large bodies are cancelled mid-stream.
 */
export const DRAIN_AFTER_CAP_BYTES = 2 * 1024 * 1024;

export async function readCapped(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let finished = false;
  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done || !value) { finished = true; break; }
    const remaining = maxBytes - total;
    chunks.push(value.length > remaining ? value.subarray(0, remaining) : value);
    total += Math.min(value.length, remaining);
  }
  if (!finished) {
    let drained = 0;
    while (drained < DRAIN_AFTER_CAP_BYTES) {
      const { done, value } = await reader.read().catch(() => ({ done: true, value: undefined as Uint8Array | undefined }));
      if (done || !value) { finished = true; break; }
      drained += value.length;
    }
  }
  if (!finished) await reader.cancel().catch(() => {});
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Release a response body the caller will never read. Drains a bounded amount (so undici's
 * parser reaches EOF unpaused on Connection: close responses — see readCapped) and cancels
 * only what remains. Fire-and-forget; never throws.
 */
export async function discardBody(res: Response): Promise<void> {
  if (!res.body) return;
  try {
    const reader = res.body.getReader();
    let drained = 0;
    while (drained < DRAIN_AFTER_CAP_BYTES) {
      const { done, value } = await reader.read();
      if (done || !value) return;
      drained += value.length;
    }
    await reader.cancel().catch(() => {});
  } catch {
    // already locked/cancelled — nothing to release
  }
}
