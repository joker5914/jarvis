# SDR Lead Gen Dashboard — Plan 4: Apollo Enrichment, Settings, Hardening, Railway Deploy

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the tool safe to host and complete for v1: Apollo people enrichment behind the provider interface and the daily budget, a Settings page for provider keys and editable scoring/category config, an SSRF-safe scraper, passphrase attempt throttling, the Plan 3 deferrals, dark mode, and a Railway deployment (web + worker + Postgres).

**Architecture:** Apollo is a fourth provider (`EnrichmentProvider`) with a cheap people search and a paid per-person reveal, each call metered by `withBudget("apollo")`; an `enrich` pg-boss job upserts Apollo contacts and re-scores. Editable configuration lives in one `AppConfig` row per owner (JSON overrides merged over the code defaults by `loadConfig`), which jobs read once per run and pass into the existing pure scoring functions. Outbound scraping goes through `safeFetch`, which resolves DNS and refuses private ranges on every redirect hop. Deployment is a multi-stage Dockerfile run as two Railway services (web, worker) against a Railway Postgres.

**Tech Stack:** Same as Plans 1–3: Next.js 15.5 App Router, TypeScript, Tailwind 4, shadcn/ui (Base UI generation), Prisma 6.19 + Postgres 16, pg-boss 12.32, zod 4, Vitest 5, Playwright, Node 22.22.3. New: `next-themes` (dark mode). `tsx` and `prisma` move to `dependencies` for the production worker and `migrate deploy`.

**Spec:** `docs/superpowers/specs/2026-09-15-sdr-lead-gen-dashboard-design.md` — sections 3.2 (EnrichmentProvider, budget wrapper), 3.3 (keys in Settings, env wins), 3.4 (gate), 4 (Contact, ProviderConfig), 5.2 (Enrich job), 5.5 (errors), 8 (Lead detail Apollo people, Leads bulk enrich, Settings), 9 (tests), 11 items 7–8. Plan 3 deferrals: `.superpowers/sdd/2026-09-16-plan3-scanner-discovery/progress.md` (final lines).

## Global Constraints

- Node 22.22.3 via nvm (`export PATH="/c/Users/cgill/AppData/Roaming/nvm/v22.22.3:$PATH"` before npm commands). Pinned majors unchanged (Next 15.5, Prisma 6, pg-boss 12, zod 4); no upgrades.
- shadcn/ui is the **Base UI generation**: no `asChild`; `render` prop; `nativeButton={false}` on a Button rendering `<a>`; `Select` takes `items` and `onValueChange` may pass `null`; `Checkbox` uses `onCheckedChange(boolean)`.
- Owner via `getActor()` in every route handler and server component; `"local-user"` only in `src/lib/actor.ts`, schema defaults, seed, tests.
- Nothing region-specific outside `src/lib/config/region.ts`; no `"America/Chicago"` literals in `src/`.
- Every Apollo HTTP call runs inside `withBudget("apollo")`; every Google call inside `withBudget("google")`. `PROVIDER_MODE=fake` never touches the network.
- Provider keys: env var wins over the stored key (`getProviderKey`); stored keys are AES-256-GCM encrypted with `APP_SECRET` (`encryptString`); no API response, log line, or activity message ever contains a key.
- The scraper and website checker never connect to loopback, private, link-local, multicast, or cloud-metadata addresses, on any redirect hop; only `http:`/`https:`; response bodies capped at `MAX_HTML_BYTES` while streaming.
- Manual jobs outrank scanner jobs (priority 10 vs 1); scanner-origin jobs honor `pauseRequested` between steps and between website fetches.
- Browser suite runs against `next build` + `next start` on port 3100 (`npm run e2e:server`); after Plan 4 it has **13** tests (5 leads, 3 projects, 2 scanner, 1 enrich, 2 settings).
- Commit after every task with a conventional-commit message ending in `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; author flags `git -c user.name="cgillett5914" -c user.email="cgillett5914@gmail.com"`. Stop servers by PID, never `taskkill /IM node.exe`. `npx tsc --noEmit` is the source of truth over editor diagnostics. Never reset the dev database.

## File structure (what this plan creates or modifies)

```
src/lib/net/ssrf.ts                       isPrivateAddress, assertSafeUrl, UnsafeUrlError, Resolver
src/lib/net/safeFetch.ts                  safeFetch(url, init, opts): manual redirects, per-hop checks, byte cap reader
src/lib/extract/website.ts                defaultFetcher via safeFetch; extractWebsiteContacts gains beforeFetch hook
src/lib/providers/validation.ts           checkWebsite via safeFetch
src/lib/auth/rateLimit.ts                 FailureRateLimiter, unlockLimiter, clientKey
src/app/api/unlock/route.ts               throttled
src/app/api/health/route.ts               GET health (no auth)
src/middleware.ts                         matcher excludes api/health
src/lib/providers/types.ts                EnrichPerson, EnrichmentProvider, Providers.enrichment
src/lib/providers/errors.ts               ProviderNotConfiguredError
src/lib/providers/keys.ts                 isProviderConfigured
src/lib/providers/apollo.ts               ApolloEnrichmentProvider
src/lib/providers/fake.ts                 FakeEnrichmentProvider
src/lib/providers/index.ts                enrichment wired in both modes
src/lib/config/enrichment.ts              ENRICH_CONFIG
src/lib/jobs/enrich.ts                    runEnrich, domainFromUrl, cityFromAddress
src/lib/jobs/queues.ts                    enrich queue (stately, 600 s), EnrichJobData
src/lib/jobs/enqueue.ts                   enqueueEnrich
src/worker/index.ts                       enrich handler
src/app/api/businesses/[id]/enrich/route.ts  POST
src/app/api/businesses/bulk/route.ts      enrich: true
src/components/leads/LeadDetail.tsx       Enrich button, People section, enriched-at
src/components/leads/BulkBar.tsx          Enrich action
prisma/schema.prisma                      AppConfig; migration app_config
src/lib/config/runtime.ts                 ConfigOverrides, overridesSchema, mergeConfig, loadConfig, saveOverrides
src/lib/scoring/smbFit.ts                 bandFor(score, thresholds?)
src/lib/scoring/packageMap.ts             suggestPackage(slug, workType, categories?)
src/lib/projects/filters.ts               thresholds parameter
src/lib/jobs/{zipSearch,tdlrSync,promote}.ts, src/lib/scanner/tick.ts, src/app/api/projects/*  read loadConfig
src/app/api/settings/route.ts             GET
src/app/api/settings/providers/[provider]/route.ts  PUT
src/app/api/settings/config/route.ts      PUT
src/components/settings/*                 ProviderKeysCard, CategoriesCard, ExclusionCard, ProjectsCard, SettingsView, types.ts
src/app/settings/page.tsx                 real page
src/lib/scanner/{state,schedule,tick,window}.ts, src/lib/jobs/websiteRecheck.ts  Plan 3 deferrals
src/components/theme/ThemeToggle.tsx, src/app/layout.tsx, src/app/globals.css     dark mode
Dockerfile, .dockerignore, railway.json, package.json scripts, README.md, .github/workflows/ci.yml  deploy
tests/unit/net/*.test.ts, tests/unit/auth/rateLimit.test.ts, tests/unit/providers/apollo.test.ts, tests/unit/config/runtime.test.ts, tests/unit/scanner/nextWindowStart.test.ts
tests/db/enrich.test.ts, tests/db/health.test.ts, tests/db/runtimeConfig.test.ts, tests/db/settings.test.ts, tests/db/scannerDeferrals.test.ts
tests/e2e/enrich.spec.ts, tests/e2e/settings.spec.ts
```

---

### Task 1: SSRF-safe fetching for the scraper and website checker

**Files:**
- Create: `src/lib/net/ssrf.ts`, `src/lib/net/safeFetch.ts`, `tests/unit/net/ssrf.test.ts`, `tests/unit/net/safeFetch.test.ts`
- Modify: `src/lib/extract/website.ts:22-44` (`defaultFetcher`), `src/lib/providers/validation.ts:6-22` (`checkWebsite`)

**Interfaces:**
- Consumes: `MAX_HTML_BYTES`, `USER_AGENT`, `REQUEST_TIMEOUT_MS`, `FetchResult`, `PageFetcher` from `website.ts`.
- Produces:
  - `type Resolver = (host: string) => Promise<string[]>`; `defaultResolver`
  - `isPrivateAddress(ip: string): boolean`
  - `class UnsafeUrlError extends Error { reason: string }`
  - `assertSafeUrl(raw: string, resolve?: Resolver): Promise<URL>`
  - `safeFetch(url: string, init?: RequestInit, opts?: { maxRedirects?: number; resolve?: Resolver; timeoutMs?: number; fetchImpl?: typeof fetch }): Promise<Response>` — follows redirects manually, checking each hop; throws `UnsafeUrlError` or `Error("too many redirects")`.
  - `readCapped(res: Response, maxBytes: number): Promise<string>` — streams and stops at the cap.

- [ ] **Step 1: Failing unit tests for address and URL checks**

Create `tests/unit/net/ssrf.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isPrivateAddress, assertSafeUrl, UnsafeUrlError } from "@/lib/net/ssrf";

const resolveTo = (ips: string[]) => async () => ips;

describe("isPrivateAddress", () => {
  it.each([
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254",
    "0.0.0.0", "100.64.0.1", "224.0.0.1", "255.255.255.255",
    "::1", "::", "fc00::1", "fd12::1", "fe80::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1",
  ])("flags %s as private", (ip) => expect(isPrivateAddress(ip)).toBe(true));
  it.each(["8.8.8.8", "172.32.0.1", "104.18.0.1", "2606:4700::1111", "::ffff:8.8.8.8"])("allows %s", (ip) =>
    expect(isPrivateAddress(ip)).toBe(false),
  );
});

describe("assertSafeUrl", () => {
  it("accepts a public https host", async () => {
    const u = await assertSafeUrl("https://example.com/contact", resolveTo(["93.184.216.34"]));
    expect(u.hostname).toBe("example.com");
  });
  it.each(["ftp://example.com/", "file:///etc/passwd", "javascript:alert(1)"])("rejects protocol %s", async (raw) => {
    await expect(assertSafeUrl(raw, resolveTo(["93.184.216.34"]))).rejects.toBeInstanceOf(UnsafeUrlError);
  });
  it("rejects localhost and .internal names before resolving", async () => {
    let resolved = false;
    const spy = async () => { resolved = true; return ["8.8.8.8"]; };
    for (const h of ["http://localhost/", "http://foo.localhost/", "http://metadata.internal/", "http://box.local/"]) {
      await expect(assertSafeUrl(h, spy)).rejects.toBeInstanceOf(UnsafeUrlError);
    }
    expect(resolved).toBe(false);
  });
  it("rejects literal private IPs and hosts that resolve to any private address", async () => {
    await expect(assertSafeUrl("http://169.254.169.254/latest/meta-data", resolveTo([]))).rejects.toThrow(/private/);
    await expect(assertSafeUrl("http://evil.example/", resolveTo(["8.8.8.8", "10.0.0.5"]))).rejects.toThrow(/private/);
    await expect(assertSafeUrl("http://[::1]/", resolveTo([]))).rejects.toThrow(/private/);
  });
  it("rejects userinfo, unresolvable hosts, and unusual ports", async () => {
    await expect(assertSafeUrl("http://user:pw@example.com/", resolveTo(["8.8.8.8"]))).rejects.toThrow(/credentials/);
    await expect(assertSafeUrl("http://nope.example/", resolveTo([]))).rejects.toThrow(/resolve/);
    await expect(assertSafeUrl("http://example.com:5432/", resolveTo(["8.8.8.8"]))).rejects.toThrow(/port/);
    await expect(assertSafeUrl("https://example.com:8443/", resolveTo(["8.8.8.8"]))).resolves.toBeInstanceOf(URL);
  });
});
```

Create `tests/unit/net/safeFetch.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/unit/net -c vitest.config.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `ssrf.ts`**

```ts
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export type Resolver = (host: string) => Promise<string[]>;

export const defaultResolver: Resolver = async (host) => {
  try {
    const all = await lookup(host, { all: true, verbatim: true });
    return all.map((a) => a.address);
  } catch {
    return [];
  }
};

export class UnsafeUrlError extends Error {
  constructor(public reason: string) {
    super(`unsafe url: ${reason}`);
    this.name = "UnsafeUrlError";
  }
}

const ALLOWED_PORTS = new Set(["", "80", "443", "8080", "8443"]);
const BLOCKED_HOST_SUFFIXES = [".localhost", ".internal", ".local", ".home.arpa"];

function v4ToInt(ip: string): number {
  return ip.split(".").reduce((n, o) => (n << 8) + Number(o), 0) >>> 0;
}
function inV4Range(ip: string, cidr: string): boolean {
  const [base, bits] = cidr.split("/");
  const mask = bits === "0" ? 0 : (~0 << (32 - Number(bits))) >>> 0;
  return (v4ToInt(ip) & mask) === (v4ToInt(base) & mask);
}
const PRIVATE_V4 = ["0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16", "172.16.0.0/12", "192.0.0.0/24", "192.168.0.0/16", "198.18.0.0/15", "224.0.0.0/4", "240.0.0.0/4"];

export function isPrivateAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return ip === "255.255.255.255" || PRIVATE_V4.some((c) => inV4Range(ip, c));
  if (kind !== 6) return true; // not an IP at all: treat as unsafe
  const lower = ip.toLowerCase();
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateAddress(mapped[1]);
  if (lower === "::" || lower === "::1") return true;
  const head = parseInt(lower.split(":")[0] || "0", 16);
  if ((head & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((head & 0xffc0) === 0xfe80) return true; // fe80::/10 link local
  if ((head & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  return false;
}

export async function assertSafeUrl(raw: string, resolve: Resolver = defaultResolver): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError("malformed");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new UnsafeUrlError(`protocol ${url.protocol}`);
  if (url.username || url.password) throw new UnsafeUrlError("credentials in url");
  if (!ALLOWED_PORTS.has(url.port)) throw new UnsafeUrlError(`port ${url.port}`);
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const bare = host.startsWith("[") ? host.slice(1, -1) : host;
  if (bare === "localhost" || BLOCKED_HOST_SUFFIXES.some((s) => bare.endsWith(s))) throw new UnsafeUrlError(`host ${bare}`);
  if (isIP(bare)) {
    if (isPrivateAddress(bare)) throw new UnsafeUrlError(`private address ${bare}`);
    return url;
  }
  const addrs = await resolve(bare);
  if (addrs.length === 0) throw new UnsafeUrlError(`cannot resolve ${bare}`);
  const bad = addrs.find(isPrivateAddress);
  if (bad) throw new UnsafeUrlError(`private address ${bad} for ${bare}`);
  return url;
}
```

- [ ] **Step 4: Implement `safeFetch.ts`**

```ts
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
      if (!res.url) Object.defineProperty(res, "url", { value: target.href });
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
```

- [ ] **Step 5: Route the scraper and website checker through it**

In `src/lib/extract/website.ts` replace `defaultFetcher` with:

```ts
import { safeFetch, readCapped } from "@/lib/net/safeFetch";
import { UnsafeUrlError } from "@/lib/net/ssrf";

export const defaultFetcher: PageFetcher = async (url) => {
  try {
    const res = await safeFetch(
      url,
      { headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1" } },
      { timeoutMs: REQUEST_TIMEOUT_MS },
    );
    if (!res.ok) return { ok: false, status: res.status, error: `HTTP ${res.status}` };
    const ct = res.headers.get("content-type") ?? "";
    if (!/text\/html|application\/xhtml/i.test(ct)) return { ok: true, status: res.status, html: "", finalUrl: res.url };
    const html = await readCapped(res, MAX_HTML_BYTES);
    return { ok: true, status: res.status, html, finalUrl: res.url };
  } catch (e) {
    const err = e as Error;
    if (err instanceof UnsafeUrlError) return { ok: false, error: err.message };
    return { ok: false, error: err?.name === "AbortError" ? "timeout" : err?.message ?? String(e) };
  }
};
```

In `src/lib/providers/validation.ts` `checkWebsite`: replace the direct `fetch(url, { method: "HEAD", redirect: "follow", ... })` (and any GET fallback) with `safeFetch(url, { method: "HEAD", headers: {...} }, { timeoutMs })`, falling back to GET the same way the current code does; catch `UnsafeUrlError` → `{ reachable: false, error: e.message }`. Keep the existing timeout and status semantics. Existing unit tests in `tests/unit/extract` use injected fetchers and must still pass unchanged.

- [ ] **Step 6: Run tests, check set, commit**

```bash
npm test && npx tsc --noEmit && npm run lint
git add -A
git commit -m "feat(security): SSRF-safe fetching — private-range and metadata blocking on every redirect hop, streamed body cap

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Passphrase attempt throttling and a health endpoint

**Files:**
- Create: `src/lib/auth/rateLimit.ts`, `src/app/api/health/route.ts`, `tests/unit/auth/rateLimit.test.ts`, `tests/db/health.test.ts`
- Modify: `src/app/api/unlock/route.ts`, `src/middleware.ts:22-24` (matcher)

**Interfaces:**
- Produces:
  - `class FailureRateLimiter { constructor(opts: { maxFailures: number; windowMs: number; lockoutMs: number; now?: () => number }); check(key: string): { allowed: boolean; retryAfterSec?: number }; recordFailure(key: string): void; reset(key: string): void; }`
  - `unlockLimiter: FailureRateLimiter` (5 failures per 15 min → 15 min lockout), cached on `globalThis` for dev HMR.
  - `clientKey(req: Request): string` — first `x-forwarded-for` entry, else `x-real-ip`, else `"unknown"`.
  - `GET /api/health` → `200 { ok: true, db: true }` or `503 { ok: false }`.

- [ ] **Step 1: Failing unit test**

`tests/unit/auth/rateLimit.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { FailureRateLimiter, clientKey } from "@/lib/auth/rateLimit";

function limiter(start = 0) {
  let t = start;
  const l = new FailureRateLimiter({ maxFailures: 3, windowMs: 60_000, lockoutMs: 120_000, now: () => t });
  return { l, advance: (ms: number) => (t += ms) };
}

describe("FailureRateLimiter", () => {
  it("allows until maxFailures within the window, then locks out with retryAfter", () => {
    const { l, advance } = limiter();
    for (let i = 0; i < 3; i++) {
      expect(l.check("a").allowed).toBe(true);
      l.recordFailure("a");
      advance(1_000);
    }
    const r = l.check("a");
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSec).toBeGreaterThan(0);
    expect(r.retryAfterSec).toBeLessThanOrEqual(120);
  });
  it("forgets failures outside the window", () => {
    const { l, advance } = limiter();
    l.recordFailure("a"); l.recordFailure("a");
    advance(61_000);
    l.recordFailure("a");
    expect(l.check("a").allowed).toBe(true);
  });
  it("lockout expires and reset clears immediately", () => {
    const { l, advance } = limiter();
    for (let i = 0; i < 3; i++) l.recordFailure("a");
    expect(l.check("a").allowed).toBe(false);
    advance(120_001);
    expect(l.check("a").allowed).toBe(true);
    for (let i = 0; i < 3; i++) l.recordFailure("b");
    l.reset("b");
    expect(l.check("b").allowed).toBe(true);
  });
  it("keys are independent", () => {
    const { l } = limiter();
    for (let i = 0; i < 3; i++) l.recordFailure("a");
    expect(l.check("z").allowed).toBe(true);
  });
});

describe("clientKey", () => {
  it("uses the first x-forwarded-for address, then x-real-ip, then unknown", () => {
    expect(clientKey(new Request("http://x", { headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.1" } }))).toBe("1.2.3.4");
    expect(clientKey(new Request("http://x", { headers: { "x-real-ip": "5.6.7.8" } }))).toBe("5.6.7.8");
    expect(clientKey(new Request("http://x"))).toBe("unknown");
  });
});
```

- [ ] **Step 2: Implement `rateLimit.ts`**

```ts
export type RateLimiterOptions = { maxFailures: number; windowMs: number; lockoutMs: number; now?: () => number };

type Entry = { failures: number[]; lockedUntil: number };

export class FailureRateLimiter {
  private entries = new Map<string, Entry>();
  private now: () => number;
  constructor(private opts: RateLimiterOptions) {
    this.now = opts.now ?? Date.now;
  }
  private entry(key: string): Entry {
    let e = this.entries.get(key);
    if (!e) {
      e = { failures: [], lockedUntil: 0 };
      this.entries.set(key, e);
    }
    return e;
  }
  check(key: string): { allowed: boolean; retryAfterSec?: number } {
    const e = this.entries.get(key);
    if (!e) return { allowed: true };
    const t = this.now();
    if (e.lockedUntil > t) return { allowed: false, retryAfterSec: Math.ceil((e.lockedUntil - t) / 1000) };
    return { allowed: true };
  }
  recordFailure(key: string): void {
    const t = this.now();
    const e = this.entry(key);
    e.failures = e.failures.filter((f) => t - f < this.opts.windowMs);
    e.failures.push(t);
    if (e.failures.length >= this.opts.maxFailures) {
      e.lockedUntil = t + this.opts.lockoutMs;
      e.failures = [];
    }
    if (this.entries.size > 10_000) this.entries.clear(); // memory bound; single-instance app
  }
  reset(key: string): void {
    this.entries.delete(key);
  }
}

export function clientKey(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim() || "unknown";
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

const g = globalThis as unknown as { unlockLimiter?: FailureRateLimiter };
/** Per-process limiter: 5 wrong passphrases in 15 minutes locks that client out for 15 minutes. */
export const unlockLimiter = (g.unlockLimiter ??= new FailureRateLimiter({ maxFailures: 5, windowMs: 15 * 60_000, lockoutMs: 15 * 60_000 }));
```

- [ ] **Step 3: Throttle the unlock route**

In `src/app/api/unlock/route.ts`, after reading `expected`/`secret`:

```ts
  const key = clientKey(req);
  const gate = unlockLimiter.check(key);
  if (!gate.allowed) {
    const url = new URL("/unlock", req.url);
    url.searchParams.set("error", "locked");
    url.searchParams.set("next", next);
    return NextResponse.redirect(url, { status: 303, headers: { "retry-after": String(gate.retryAfterSec ?? 900) } });
  }
  if (!safeEqual(passphrase, expected)) {
    unlockLimiter.recordFailure(key);
    await new Promise((r) => setTimeout(r, 300)); // constant small delay on failure
    ...existing redirect with error=1...
  }
  unlockLimiter.reset(key);
```

In the unlock page (`src/app/unlock/page.tsx`), when `error === "locked"` show "Too many attempts. Try again in 15 minutes." (keep the existing wrong-passphrase message for `error=1`). Existing `tests/unit/unlockRedirect.test.ts` must still pass.

- [ ] **Step 4: Health endpoint and middleware exclusion**

`src/app/api/health/route.ts`:

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true, db: true });
  } catch {
    return NextResponse.json({ ok: false, db: false }, { status: 503 });
  }
}
```

`src/middleware.ts` matcher: `"/((?!unlock|api/unlock|api/health|_next/static|_next/image|favicon.ico).*)"`.

`tests/db/health.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { GET } from "@/app/api/health/route";

describe("GET /api/health", () => {
  it("reports ok with a live database", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, db: true });
  });
});
```

- [ ] **Step 5: Verify, commit**

```bash
npm test && npm run test:db && npx tsc --noEmit && npm run lint
git add -A
git commit -m "feat(security): throttle passphrase attempts; add /api/health

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Apollo enrichment provider (interface, real, fake)

**Files:**
- Create: `src/lib/providers/apollo.ts`, `src/lib/providers/errors.ts`, `src/lib/config/enrichment.ts`, `tests/unit/providers/apollo.test.ts`
- Modify: `src/lib/providers/types.ts`, `src/lib/providers/keys.ts`, `src/lib/providers/fake.ts`, `src/lib/providers/index.ts`, `.env.example`

**Interfaces:**
- Consumes: `withBudget`, `getProviderKey`, `BudgetExhaustedError`.
- Produces:
  - `type EnrichPerson = { apolloId: string; firstName: string | null; lastName: string | null; name: string | null; title: string | null; email: string | null; emailStatus: string | null; linkedinUrl: string | null; hasEmail: boolean }`
  - `interface EnrichmentProvider { searchPeople(q: { domain: string | null; orgName: string; city: string | null }, max: number): Promise<EnrichPerson[]>; enrichPerson(apolloId: string): Promise<EnrichPerson | null> }`
  - `Providers.enrichment: EnrichmentProvider`
  - `class ProviderNotConfiguredError extends Error { provider: string }`
  - `isProviderConfigured(provider: "google" | "apollo"): Promise<boolean>` — true in fake mode.
  - `ENRICH_CONFIG = { maxPeople: 5, preferredTitles: [...], seniorities: [...] }`
  - `FakeEnrichmentProvider` with `calls = { search: 0, enrich: 0 }`; deterministic people.

Apollo HTTP contract (from https://docs.apollo.io/reference/people-api-search and /people-enrichment, fetched 2026-09-16):
- Search: `POST https://api.apollo.io/api/v1/mixed_people/api_search`, header `x-api-key`, JSON body params `q_organization_domains_list[]`, `person_titles[]`, `include_similar_titles`, `person_seniorities[]`, `per_page`, `page`; response `{ total_entries, people: [{ id, first_name, last_name_obfuscated, title, has_email, organization: { name } }] }`. **No emails in search results; 0 credits.**
- Enrich: `POST https://api.apollo.io/api/v1/people/match?id=<id>&reveal_personal_emails=false`, response `{ person: { id, first_name, last_name, name, title, email, email_status, linkedin_url, match_confidence } }`. 1 credit when data is returned; 429 on rate limit (600/h).

- [ ] **Step 1: Types, config, errors**

`src/lib/providers/types.ts` — add before `Providers`:

```ts
export type EnrichPerson = {
  apolloId: string;
  firstName: string | null;
  lastName: string | null;
  name: string | null;
  title: string | null;
  email: string | null;
  emailStatus: string | null;
  linkedinUrl: string | null;
  hasEmail: boolean;
};

export interface EnrichmentProvider {
  /** Cheap people lookup by employer domain (fallback: org name + city). Never returns emails. */
  searchPeople(q: { domain: string | null; orgName: string; city: string | null }, max: number): Promise<EnrichPerson[]>;
  /** Paid reveal for one person (email, LinkedIn). Null when Apollo has no match. */
  enrichPerson(apolloId: string): Promise<EnrichPerson | null>;
}
```
and `enrichment: EnrichmentProvider;` inside `Providers`.

`src/lib/providers/errors.ts`:

```ts
export class ProviderNotConfiguredError extends Error {
  constructor(public provider: string) {
    super(`${provider} API key is not configured`);
    this.name = "ProviderNotConfiguredError";
  }
}
```

`src/lib/providers/keys.ts` — add:

```ts
export async function isProviderConfigured(provider: keyof typeof ENV_NAMES): Promise<boolean> {
  if ((process.env.PROVIDER_MODE ?? "fake") === "fake") return true;
  return (await getProviderKey(provider)) !== null;
}
```

`src/lib/config/enrichment.ts`:

```ts
/** Apollo people enrichment defaults (spec 5.2): at most 5 people per business, decision-makers first. */
export const ENRICH_CONFIG = {
  maxPeople: 5,
  preferredTitles: ["owner", "founder", "general manager", "office manager", "president", "ceo", "manager"],
  seniorities: ["owner", "founder", "c_suite", "vp", "director", "manager"],
} as const;
```

- [ ] **Step 2: Failing unit test for the real provider (mocked fetch)**

`tests/unit/providers/apollo.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/providers/budget", () => ({ withBudget: async (_p: string, fn: () => Promise<unknown>) => fn() }));
vi.mock("@/lib/providers/keys", () => ({ getProviderKey: async () => "test-key" }));

import { ApolloEnrichmentProvider } from "@/lib/providers/apollo";

type Call = { url: string; init: RequestInit };
let calls: Call[];
function mockFetch(handler: (c: Call) => Response) {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => { const c = { url, init }; calls.push(c); return handler(c); }));
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => vi.useRealTimers());
afterEach(() => vi.unstubAllGlobals());

describe("ApolloEnrichmentProvider.searchPeople", () => {
  it("posts domain, titles, seniorities and per_page with the api key header, and ranks owners first", async () => {
    mockFetch(() => json({ total_entries: 3, people: [
      { id: "p1", first_name: "Sam", last_name_obfuscated: "K.", title: "Barista", has_email: true },
      { id: "p2", first_name: "Maria", last_name_obfuscated: "L.", title: "Owner", has_email: true },
      { id: "p3", first_name: "Lee", last_name_obfuscated: "T.", title: "General Manager", has_email: false },
    ] }));
    const p = new ApolloEnrichmentProvider();
    const people = await p.searchPeople({ domain: "bellanails.com", orgName: "Bella Nails", city: "Houston" }, 5);
    expect(calls[0].url).toBe("https://api.apollo.io/api/v1/mixed_people/api_search");
    expect((calls[0].init.headers as Record<string, string>)["x-api-key"]).toBe("test-key");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.q_organization_domains_list).toEqual(["bellanails.com"]);
    expect(body.per_page).toBe(5);
    expect(body.person_titles).toContain("owner");
    expect(body.person_seniorities).toContain("owner");
    expect(people.map((x) => x.apolloId)).toEqual(["p2", "p3", "p1"]);
    expect(people[0]).toMatchObject({ firstName: "Maria", lastName: null, title: "Owner", email: null, hasEmail: true });
  });
  it("falls back to keyword + location when there is no domain", async () => {
    mockFetch(() => json({ total_entries: 0, people: [] }));
    await new ApolloEnrichmentProvider().searchPeople({ domain: null, orgName: "Bella Nails", city: "Houston" }, 5);
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.q_organization_domains_list).toBeUndefined();
    expect(body.q_keywords).toBe("Bella Nails");
    expect(body.organization_locations).toEqual(["Houston"]);
  });
  it("treats 422 as no results and throws on other errors", async () => {
    mockFetch(() => json({ error: "bad" }, 422));
    expect(await new ApolloEnrichmentProvider().searchPeople({ domain: "x.com", orgName: "X", city: null }, 5)).toEqual([]);
    mockFetch(() => json({ error: "slow down" }, 429));
    await expect(new ApolloEnrichmentProvider().searchPeople({ domain: "x.com", orgName: "X", city: null }, 5)).rejects.toThrow(/429/);
  });
});

describe("ApolloEnrichmentProvider.enrichPerson", () => {
  it("posts people/match with the id and maps email and linkedin", async () => {
    mockFetch(() => json({ person: { id: "p2", first_name: "Maria", last_name: "Lopez", name: "Maria Lopez", title: "Owner", email: "maria@bellanails.com", email_status: "verified", linkedin_url: "https://www.linkedin.com/in/maria-lopez", match_confidence: "high" } }));
    const r = await new ApolloEnrichmentProvider().enrichPerson("p2");
    expect(calls[0].url).toMatch(/^https:\/\/api\.apollo\.io\/api\/v1\/people\/match\?/);
    expect(new URL(calls[0].url).searchParams.get("id")).toBe("p2");
    expect(new URL(calls[0].url).searchParams.get("reveal_personal_emails")).toBe("false");
    expect(r).toMatchObject({ apolloId: "p2", name: "Maria Lopez", email: "maria@bellanails.com", emailStatus: "verified", linkedinUrl: "https://www.linkedin.com/in/maria-lopez" });
  });
  it("returns null when match_confidence is none or person missing", async () => {
    mockFetch(() => json({ person: null }));
    expect(await new ApolloEnrichmentProvider().enrichPerson("nope")).toBeNull();
    mockFetch(() => json({ person: { id: "x", match_confidence: "none" } }));
    expect(await new ApolloEnrichmentProvider().enrichPerson("x")).toBeNull();
  });
});
```

Run: `npx vitest run tests/unit/providers/apollo.test.ts -c vitest.config.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `apollo.ts`**

```ts
import { withBudget } from "./budget";
import { getProviderKey } from "./keys";
import { ProviderNotConfiguredError } from "./errors";
import { ENRICH_CONFIG } from "@/lib/config/enrichment";
import type { EnrichPerson, EnrichmentProvider } from "./types";

const BASE = "https://api.apollo.io/api/v1";

type SearchPerson = { id: string; first_name?: string | null; last_name_obfuscated?: string | null; title?: string | null; has_email?: boolean | null };
type MatchPerson = { id: string; first_name?: string | null; last_name?: string | null; name?: string | null; title?: string | null; email?: string | null; email_status?: string | null; linkedin_url?: string | null; match_confidence?: string | null };

async function requireKey() {
  const key = await getProviderKey("apollo");
  if (!key) throw new ProviderNotConfiguredError("apollo");
  return key;
}

function titleRank(title: string | null | undefined): number {
  const t = (title ?? "").toLowerCase();
  const i = ENRICH_CONFIG.preferredTitles.findIndex((p) => t.includes(p));
  return i === -1 ? ENRICH_CONFIG.preferredTitles.length : i;
}

export class ApolloEnrichmentProvider implements EnrichmentProvider {
  async searchPeople(q: { domain: string | null; orgName: string; city: string | null }, max: number): Promise<EnrichPerson[]> {
    const key = await requireKey();
    const body: Record<string, unknown> = {
      person_titles: [...ENRICH_CONFIG.preferredTitles],
      include_similar_titles: true,
      person_seniorities: [...ENRICH_CONFIG.seniorities],
      per_page: max,
      page: 1,
    };
    if (q.domain) body.q_organization_domains_list = [q.domain];
    else {
      body.q_keywords = q.orgName;
      if (q.city) body.organization_locations = [q.city];
    }
    const data = await withBudget("apollo", async () => {
      const res = await fetch(`${BASE}/mixed_people/api_search`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", "x-api-key": key },
        body: JSON.stringify(body),
      });
      if (res.status === 422) return { people: [] as SearchPerson[] };
      if (!res.ok) throw new Error(`Apollo search HTTP ${res.status}`);
      return (await res.json()) as { people?: SearchPerson[] };
    });
    const people = (data.people ?? []).map<EnrichPerson>((p) => ({
      apolloId: p.id,
      firstName: p.first_name ?? null,
      lastName: null, // search results obfuscate last names
      name: p.first_name ?? null,
      title: p.title ?? null,
      email: null,
      emailStatus: null,
      linkedinUrl: null,
      hasEmail: !!p.has_email,
    }));
    people.sort((a, b) => titleRank(a.title) - titleRank(b.title) || Number(b.hasEmail) - Number(a.hasEmail));
    return people.slice(0, max);
  }

  async enrichPerson(apolloId: string): Promise<EnrichPerson | null> {
    const key = await requireKey();
    const url = new URL(`${BASE}/people/match`);
    url.searchParams.set("id", apolloId);
    url.searchParams.set("reveal_personal_emails", "false");
    url.searchParams.set("reveal_phone_number", "false");
    const data = await withBudget("apollo", async () => {
      const res = await fetch(url.href, { method: "POST", headers: { accept: "application/json", "x-api-key": key } });
      if (!res.ok) throw new Error(`Apollo match HTTP ${res.status}`);
      return (await res.json()) as { person?: MatchPerson | null };
    });
    const p = data.person;
    if (!p || p.match_confidence === "none") return null;
    return {
      apolloId: p.id,
      firstName: p.first_name ?? null,
      lastName: p.last_name ?? null,
      name: p.name ?? [p.first_name, p.last_name].filter(Boolean).join(" ") || null,
      title: p.title ?? null,
      email: p.email ?? null,
      emailStatus: p.email_status ?? null,
      linkedinUrl: p.linkedin_url ?? null,
      hasEmail: !!p.email,
    };
  }
}
```

- [ ] **Step 4: Fake provider and wiring**

In `src/lib/providers/fake.ts` add:

```ts
export class FakeEnrichmentProvider implements EnrichmentProvider {
  calls = { search: 0, enrich: 0 };
  async searchPeople(q: { domain: string | null; orgName: string; city: string | null }, max: number): Promise<EnrichPerson[]> {
    this.calls.search++;
    const domain = q.domain ?? `${q.orgName.toLowerCase().replace(/[^a-z0-9]+/g, "")}.example`;
    const people: EnrichPerson[] = [
      { apolloId: `fake-${domain}-owner`, firstName: "Maria", lastName: null, name: "Maria", title: "Owner", email: null, emailStatus: null, linkedinUrl: null, hasEmail: true },
      { apolloId: `fake-${domain}-gm`, firstName: "Lee", lastName: null, name: "Lee", title: "General Manager", email: null, emailStatus: null, linkedinUrl: null, hasEmail: false },
    ];
    return people.slice(0, max);
  }
  async enrichPerson(apolloId: string): Promise<EnrichPerson | null> {
    this.calls.enrich++;
    const m = apolloId.match(/^fake-(.+)-(owner|gm)$/);
    if (!m) return null;
    const [, domain, role] = m;
    if (role === "gm") return { apolloId, firstName: "Lee", lastName: "Tran", name: "Lee Tran", title: "General Manager", email: null, emailStatus: null, linkedinUrl: "https://www.linkedin.com/in/lee-tran-fake", hasEmail: false };
    return { apolloId, firstName: "Maria", lastName: "Lopez", name: "Maria Lopez", title: "Owner", email: `owner@${domain}`, emailStatus: "verified", linkedinUrl: "https://www.linkedin.com/in/maria-lopez-fake", hasEmail: true };
  }
}
```
(import `EnrichPerson`, `EnrichmentProvider` from `./types`.)

`src/lib/providers/index.ts`: add `enrichment: new FakeEnrichmentProvider()` in fake mode and `enrichment: new ApolloEnrichmentProvider()` in real mode.

`.env.example`: add `APOLLO_API_KEY=""` and `APOLLO_DAILY_BUDGET="300"` with a comment "or paste the key in Settings; env wins".

- [ ] **Step 5: Verify, commit**

```bash
npm test && npx tsc --noEmit && npm run lint
git add -A
git commit -m "feat(apollo): EnrichmentProvider interface, Apollo implementation with budget metering, fake provider

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Enrich job, queue, worker, and API

**Files:**
- Create: `src/lib/jobs/enrich.ts`, `src/app/api/businesses/[id]/enrich/route.ts`, `tests/db/enrich.test.ts`, `tests/unit/jobs/enrichHelpers.test.ts`
- Modify: `src/lib/jobs/queues.ts`, `src/lib/jobs/enqueue.ts`, `src/worker/index.ts`, `src/app/api/businesses/bulk/route.ts`

**Interfaces:**
- Consumes: `EnrichmentProvider` (Task 3), `validateEmails`, `recomputeContactQuality` (`zipSearch.ts`), `upsertIgnoringConflict`, `JobDeps`, `checkPause` (`shared.ts`), `isProviderConfigured`, `BudgetExhaustedError`, `ProviderNotConfiguredError`.
- Produces:
  - `domainFromUrl(url: string | null): string | null` (hostname without `www.`, lowercase; null for invalid)
  - `cityFromAddress(addr: string | null): string | null` (second-to-last comma segment of a US formatted address, e.g. `"123 Main St, Houston, TX 77084, USA"` → `"Houston"`)
  - `runEnrich(businessId: string, ownerId: string, deps: JobDeps): Promise<{ added: number; updated: number; skipped: "excluded" | "not_found" | null }>`
  - `QUEUES.enrich = "enrich"`, `EnrichJobData = { businessId: string; ownerId: string }`, `QUEUE_OPTIONS.enrich = { expireInSeconds: 600, policy: "stately" }`
  - `enqueueEnrich(businessId: string, ownerId: string): Promise<boolean>` (singletonKey = businessId; inline mode runs `runEnrich` with the real providers; `retryLimit: 2, retryDelay: 60`)
  - `POST /api/businesses/[id]/enrich` → `202 { queued: boolean }`; `404` unknown/unowned; `409 { error: "Apollo API key is not configured", settingsHref: "/settings" }` when not configured.
  - `POST /api/businesses/bulk` accepts `enrich?: boolean` (max 200 ids per call when enriching) → response gains `enrichQueued: number`.

- [ ] **Step 1: Helper unit tests then helpers**

`tests/unit/jobs/enrichHelpers.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { domainFromUrl, cityFromAddress } from "@/lib/jobs/enrich";

describe("domainFromUrl", () => {
  it.each([
    ["https://www.BellaNails.com/contact", "bellanails.com"],
    ["http://cafe.example", "cafe.example"],
    ["bellanails.com", "bellanails.com"],
    [null, null], ["not a url", null], ["https://facebook.com/bella", null], ["https://sites.google.com/x", null],
  ])("%s → %s", (input, out) => expect(domainFromUrl(input)).toBe(out));
});

describe("cityFromAddress", () => {
  it.each([
    ["123 Main St, Houston, TX 77084, USA", "Houston"],
    ["500 Elm, Suite 2, Katy, TX 77450, United States", "Katy"],
    ["Houston, TX", "Houston"],
    [null, null], ["", null],
  ])("%s → %s", (input, out) => expect(cityFromAddress(input)).toBe(out));
});
```

In `src/lib/jobs/enrich.ts`:

```ts
const SOCIAL_HOSTS = ["facebook.com", "instagram.com", "linkedin.com", "yelp.com", "twitter.com", "x.com", "sites.google.com", "business.site", "wixsite.com", "squarespace.com", "godaddysites.com"];

export function domainFromUrl(url: string | null): string | null {
  if (!url) return null;
  const raw = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  try {
    const host = new URL(raw).hostname.toLowerCase().replace(/^www\./, "");
    if (!host.includes(".")) return null;
    if (SOCIAL_HOSTS.some((s) => host === s || host.endsWith(`.${s}`))) return null;
    return host;
  } catch {
    return null;
  }
}

export function cityFromAddress(addr: string | null): string | null {
  if (!addr) return null;
  const parts = addr.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.length === 1) return null;
  const last = parts[parts.length - 1];
  const isCountry = /^(usa|united states|us)$/i.test(last);
  const stateZipIdx = isCountry ? parts.length - 2 : parts.length - 1;
  const city = parts[stateZipIdx - 1];
  return city && !/\d/.test(city) ? city : null;
}
```

- [ ] **Step 2: Failing DB test for the job**

`tests/db/enrich.test.ts` (follow `tests/db` conventions: setup file wires `TEST_DATABASE_URL`, unique owner, `deleteMany` cleanup):

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { runEnrich } from "@/lib/jobs/enrich";
import { FakeEnrichmentProvider, FakeValidationProvider, FakeDiscoveryProvider, FakeGeocodeProvider, FakeRegistryProvider, fakeFetcher } from "@/lib/providers/fake";
import { BudgetExhaustedError } from "@/lib/providers/budget";
import type { JobDeps } from "@/lib/jobs/shared";

const OWNER = "test-enrich-owner";
async function cleanup() {
  await prisma.activityLog.deleteMany({ where: { ownerId: OWNER } });
  await prisma.contact.deleteMany({ where: { ownerId: OWNER } });
  await prisma.business.deleteMany({ where: { ownerId: OWNER } });
}
beforeEach(cleanup);
afterAll(cleanup);

function deps(enrichment = new FakeEnrichmentProvider()): JobDeps & { enrichment: FakeEnrichmentProvider } {
  return {
    providers: { geocode: new FakeGeocodeProvider(), discovery: new FakeDiscoveryProvider(), validation: new FakeValidationProvider(), registry: new FakeRegistryProvider(), fetcher: fakeFetcher, enrichment },
    log: () => {},
    enrichment,
  } as never;
}

async function biz(over: Partial<Parameters<typeof prisma.business.create>[0]["data"]> = {}) {
  return prisma.business.create({ data: { ownerId: OWNER, name: "Bella Nails & Spa", websiteUrl: "https://www.bellanails.com", formattedAddress: "123 Main St, Houston, TX 77084, USA", source: "zip_search", ...over } });
}

describe("runEnrich", () => {
  it("adds Apollo contacts with names and titles, validates, re-scores, logs, and stamps lastEnrichedAt", async () => {
    const b = await biz();
    const d = deps();
    const r = await runEnrich(b.id, OWNER, d);
    expect(r).toEqual({ added: 2, updated: 0, skipped: null });
    expect(d.enrichment.calls).toEqual({ search: 1, enrich: 2 });
    const contacts = await prisma.contact.findMany({ where: { businessId: b.id }, orderBy: { value: "asc" } });
    const email = contacts.find((c) => c.type === "email");
    expect(email).toMatchObject({ value: "owner@bellanails.com", source: "apollo", personName: "Maria Lopez", personTitle: "Owner", validationStatus: "valid" });
    expect(contacts.filter((c) => c.type === "linkedin")).toHaveLength(2);
    const after = await prisma.business.findUniqueOrThrow({ where: { id: b.id } });
    expect(after.lastEnrichedAt).not.toBeNull();
    expect(after.contactQualityScore).toBeGreaterThanOrEqual(45); // email valid (30) + named person (15) at minimum
    const log = await prisma.activityLog.findMany({ where: { businessId: b.id, kind: "enriched" } });
    expect(log).toHaveLength(1);
    expect(log[0].message).toMatch(/Apollo/);
  });
  it("is idempotent: a second run updates instead of duplicating", async () => {
    const b = await biz();
    await runEnrich(b.id, OWNER, deps());
    const r = await runEnrich(b.id, OWNER, deps());
    expect(r.added).toBe(0);
    expect(await prisma.contact.count({ where: { businessId: b.id } })).toBe(3);
  });
  it("fills the name and title on an existing website email instead of creating a duplicate", async () => {
    const b = await biz();
    await prisma.contact.create({ data: { ownerId: OWNER, businessId: b.id, type: "email", value: "owner@bellanails.com", source: "website" } });
    const r = await runEnrich(b.id, OWNER, deps());
    expect(r.updated).toBe(1);
    const c = await prisma.contact.findFirstOrThrow({ where: { businessId: b.id, type: "email" } });
    expect(c).toMatchObject({ source: "website", personName: "Maria Lopez", personTitle: "Owner" });
  });
  it("skips excluded businesses without calling Apollo", async () => {
    const b = await biz({ exclusion: "enterprise" });
    const d = deps();
    expect(await runEnrich(b.id, OWNER, d)).toEqual({ added: 0, updated: 0, skipped: "excluded" });
    expect(d.enrichment.calls.search).toBe(0);
  });
  it("falls back to name + city when there is no usable domain", async () => {
    const b = await biz({ websiteUrl: "https://facebook.com/bella" });
    const d = deps();
    await runEnrich(b.id, OWNER, d);
    expect(d.enrichment.calls.search).toBe(1);
    expect(await prisma.contact.count({ where: { businessId: b.id, source: "apollo" } })).toBeGreaterThan(0);
  });
  it("logs and rethrows when the Apollo budget is exhausted", async () => {
    const b = await biz();
    const fake = new FakeEnrichmentProvider();
    fake.searchPeople = async () => { throw new BudgetExhaustedError("apollo"); };
    await expect(runEnrich(b.id, OWNER, deps(fake))).rejects.toBeInstanceOf(BudgetExhaustedError);
    const log = await prisma.activityLog.findFirst({ where: { businessId: b.id } });
    expect(log?.message).toMatch(/budget/i);
    expect((await prisma.business.findUniqueOrThrow({ where: { id: b.id } })).lastEnrichedAt).toBeNull();
  });
});
```

- [ ] **Step 3: Implement `runEnrich`**

```ts
import { prisma } from "@/lib/db";
import { checkPause, upsertIgnoringConflict, type JobDeps } from "./shared";
import { validateEmails, recomputeContactQuality } from "./zipSearch";
import { ENRICH_CONFIG } from "@/lib/config/enrichment";
import { BudgetExhaustedError } from "@/lib/providers/budget";
import { ProviderNotConfiguredError } from "@/lib/providers/errors";
import type { EnrichPerson } from "@/lib/providers/types";

function canonicalLinkedin(url: string): string {
  const u = new URL(url);
  return `https://www.linkedin.com${u.pathname.replace(/\/+$/, "")}`;
}

export async function runEnrich(businessId: string, ownerId: string, deps: JobDeps) {
  const b = await prisma.business.findFirst({ where: { id: businessId, ownerId } });
  if (!b) return { added: 0, updated: 0, skipped: "not_found" as const };
  if (b.exclusion !== "none") return { added: 0, updated: 0, skipped: "excluded" as const };
  const log = (message: string) => prisma.activityLog.create({ data: { ownerId, businessId, kind: "enriched", message } });
  let added = 0;
  let updated = 0;
  try {
    await checkPause(deps);
    const domain = domainFromUrl(b.websiteUrl);
    const people = await deps.providers.enrichment.searchPeople({ domain, orgName: b.name, city: cityFromAddress(b.formattedAddress) }, ENRICH_CONFIG.maxPeople);
    for (const p of people.slice(0, ENRICH_CONFIG.maxPeople)) {
      await checkPause(deps);
      const full: EnrichPerson | null = p.email ? p : await deps.providers.enrichment.enrichPerson(p.apolloId);
      if (!full) continue;
      const personName = full.name;
      const personTitle = full.title;
      const rows: { type: "email" | "linkedin"; value: string }[] = [];
      if (full.email) rows.push({ type: "email", value: full.email.toLowerCase() });
      if (full.linkedinUrl) rows.push({ type: "linkedin", value: canonicalLinkedin(full.linkedinUrl) });
      for (const r of rows) {
        const existing = await prisma.contact.findUnique({ where: { businessId_type_value: { businessId, type: r.type, value: r.value } } });
        if (existing) {
          if ((!existing.personName && personName) || (!existing.personTitle && personTitle)) {
            await prisma.contact.update({ where: { id: existing.id }, data: { personName: existing.personName ?? personName, personTitle: existing.personTitle ?? personTitle } });
            updated++;
          }
          continue;
        }
        await upsertIgnoringConflict(() =>
          prisma.contact.create({ data: { ownerId, businessId, type: r.type, value: r.value, source: "apollo", personName, personTitle } }),
        );
        added++;
      }
    }
    await validateEmails([businessId], deps);
    await recomputeContactQuality(businessId);
    await prisma.business.update({ where: { id: businessId }, data: { lastEnrichedAt: new Date() } });
    await log(`Enriched via Apollo: ${added} new contact${added === 1 ? "" : "s"}, ${updated} updated`);
    return { added, updated, skipped: null };
  } catch (e) {
    if (e instanceof BudgetExhaustedError) await log("Enrichment paused: Apollo daily budget exhausted");
    else if (e instanceof ProviderNotConfiguredError) await log("Enrichment skipped: Apollo API key is not configured");
    throw e;
  }
}
```
(Read `shared.ts` for the exact `JobDeps` shape and whether `log` is a member; read `zipSearch.ts` `validateEmails` signature — it takes `(businessIds, deps)` — and reuse; if `validateEmails` only validates `unchecked` emails, that is the intended behaviour.)

- [ ] **Step 4: Queue, enqueue, worker, API**

`queues.ts`: add `enrich: "enrich"` to `QUEUES`, `export type EnrichJobData = { businessId: string; ownerId: string }`, and `enrich: { expireInSeconds: 600, policy: "stately" }` to `QUEUE_OPTIONS`.

`enqueue.ts`:

```ts
export async function enqueueEnrich(businessId: string, ownerId: string): Promise<boolean> {
  if (process.env.JOB_MODE === "inline") {
    const { runEnrich } = await import("./enrich");
    await runEnrich(businessId, ownerId, { providers: getProviders(), log: console.log });
    return true;
  }
  const boss = await getBoss();
  const id = await boss.send(QUEUES.enrich, { businessId, ownerId } satisfies EnrichJobData, { singletonKey: businessId, priority: MANUAL_PRIORITY, retryLimit: 2, retryDelay: 60, expireInSeconds: QUEUE_OPTIONS.enrich.expireInSeconds });
  return id !== null;
}
```
(Match how the other inline branches build `deps` — copy the exact object the zip-search inline branch uses.)

`worker/index.ts`: `boss.work(QUEUES.enrich, { batchSize: 1 }, async ([job]) => { const { businessId, ownerId } = job.data as EnrichJobData; await runEnrich(businessId, ownerId, deps); })` where `deps` is the same object the zip-search handler passes (no `shouldPause` — enrich is manual-origin).

`src/app/api/businesses/[id]/enrich/route.ts`:

```ts
import { prisma } from "@/lib/db";
import { getActor } from "@/lib/actor";
import { ApiError, handle, json } from "@/lib/api";
import { enqueueEnrich } from "@/lib/jobs/enqueue";
import { isProviderConfigured } from "@/lib/providers/keys";

export const POST = handle(async (_req, ctx) => {
  const { id } = await ctx.params;
  const actor = await getActor();
  const b = await prisma.business.findFirst({ where: { id, ownerId: actor.id }, select: { id: true } });
  if (!b) throw new ApiError(404, "Business not found");
  if (!(await isProviderConfigured("apollo"))) {
    return json({ error: "Apollo API key is not configured", settingsHref: "/settings" }, 409);
  }
  const queued = await enqueueEnrich(b.id, actor.id);
  return json({ queued }, 202);
});
```

`bulk/route.ts`: add `enrich: z.boolean().optional()` to the schema; if `body.enrich`: if `ids.length > 200` → `ApiError(400, "Enrich at most 200 leads per action")`; if not configured → `ApiError(409, "Apollo API key is not configured")`; then `for (const id of ids) if (await enqueueEnrich(id, actor.id)) enrichQueued++`; include `enrichQueued` in the response.

- [ ] **Step 5: Verify, worker smoke, commit**

```bash
npm test && npm run test:db && npx tsc --noEmit && npm run lint
# worker smoke: npm run worker → "worker ready" and the new queue reconciled; stop by PID
git add -A
git commit -m "feat(apollo): enrich job, queue, worker handler, single and bulk enrich API

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Enrichment UI and browser test

**Files:**
- Modify: `src/components/leads/LeadDetail.tsx`, `src/components/leads/BulkBar.tsx`
- Create: `tests/e2e/enrich.spec.ts`

**Interfaces:**
- Consumes: `POST /api/businesses/[id]/enrich`, bulk `enrich: true`; `LeadDetail` props (`contacts`, `activity`, `lastEnrichedAt`).
- Produces testids: `enrich-button`, `people-section`, `people-row`, `bulk-enrich`.

- [ ] **Step 1: Lead detail**

In `LeadDetail.tsx` header actions add:

```tsx
<Button size="sm" variant="outline" data-testid="enrich-button" disabled={enriching} onClick={enrich}>
  {enriching ? "Enriching…" : "Enrich with Apollo"}
</Button>
```
with:

```tsx
const [enriching, setEnriching] = useState(false);
async function enrich() {
  setEnriching(true);
  try {
    const r = await fetch(`/api/businesses/${b.id}/enrich`, { method: "POST" });
    const data = await r.json().catch(() => ({}));
    if (r.status === 409) { toast.error(data.error ?? "Apollo is not configured", { action: { label: "Settings", onClick: () => router.push("/settings") } }); return; }
    if (!r.ok) { toast.error(data.error ?? "Enrichment failed"); return; }
    toast.success("Enrichment queued");
    onChanged?.(); // whatever refresh hook LeadDetail already exposes (router.refresh() for the full page)
  } finally { setEnriching(false); }
}
```
Read the component to find how it refreshes after outreach edits and reuse that (the drawer and the full page both render this component).

Add a **People** section between Contacts and Outreach:

```tsx
<section className="space-y-2" data-testid="people-section">
  <h3 className="font-medium">People</h3>
  {people.length === 0 ? <p className="text-sm text-neutral-500">No named contacts yet. Enrich with Apollo to find decision-makers.</p> : (
    <ul className="space-y-1">
      {people.map((p) => (
        <li key={p.key} data-testid="people-row" className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">{p.name}</span>
          {p.title && <span className="text-neutral-500">{p.title}</span>}
          {p.email && <CopyButton value={p.email} label={p.email} />}
          {p.linkedin && <a className="underline" href={p.linkedin} target="_blank" rel="noreferrer">LinkedIn</a>}
          <SourceBadge source={p.source} />
        </li>
      ))}
    </ul>
  )}
  {b.lastEnrichedAt && <p className="text-xs text-neutral-500">Enriched {timeAgo(b.lastEnrichedAt)}</p>}
</section>
```
where `people` groups `b.contacts` that have `personName` by name: `{ key, name, title, email, linkedin, source }` (email = the email contact with that name, linkedin = the linkedin contact with that name). Check `SourceBadge` accepts `"apollo"` (add the label/color if missing). Keep the existing Contacts section unchanged.

- [ ] **Step 2: Bulk bar**

Add a button `data-testid="bulk-enrich"` labelled "Enrich" that calls the existing `apply({ enrich: true })` helper; on 409 show the toast with a Settings action; on success toast `Queued ${enrichQueued} for enrichment`.

- [ ] **Step 3: e2e**

`tests/e2e/enrich.spec.ts` (mirror `leads.spec.ts` for how a zip search is started and how a lead is opened; inline job mode runs enrich synchronously so the 202 returns after completion):

```ts
import { test, expect } from "@playwright/test";
import { unlock } from "./helpers";

test("enrich a lead with Apollo (fake) adds named people", async ({ page }) => {
  await unlock(page);
  // Start a search the same way leads.spec does and wait for the first complete search card.
  await page.goto("/");
  await page.getByTestId("zip-input").fill("77084");
  await page.getByTestId("run-search").click();
  await page.goto("/searches");
  await expect(page.locator('[data-testid="search-card"][data-status="complete"]').first()).toBeVisible({ timeout: 45_000 });
  await page.goto("/leads");
  await page.getByTestId("lead-row").first().click();
  await page.getByTestId("enrich-button").click();
  await expect(page.getByText("Enrichment queued")).toBeVisible();
  await expect(page.getByTestId("people-row").first()).toContainText("Maria Lopez", { timeout: 15_000 });
  await expect(page.getByTestId("people-section")).toContainText("Owner");
});
```
Adjust the testids used for zip input, run button, and lead row to the ones that exist (read `leads.spec.ts` and the components; do not invent new ones).

- [ ] **Step 4: Verify, commit**

```bash
npx tsc --noEmit && npm run lint && npm test && npm run test:e2e   # 11 passed
git add -A
git commit -m "feat(apollo): Enrich button and People section on lead detail; bulk Enrich; e2e

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Editable runtime configuration (`AppConfig` + `loadConfig`)

**Files:**
- Create: `src/lib/config/runtime.ts`, `tests/unit/config/runtime.test.ts`, `tests/db/runtimeConfig.test.ts`, migration `app_config`
- Modify: `prisma/schema.prisma`, `src/lib/scoring/smbFit.ts:33-37` (`bandFor`), `src/lib/scoring/packageMap.ts`, `src/lib/projects/filters.ts`, `src/lib/jobs/zipSearch.ts`, `src/lib/jobs/tdlrSync.ts`, `src/lib/jobs/promote.ts`, `src/lib/scanner/tick.ts`, `src/app/api/projects/route.ts`, `src/app/api/projects/promote-high-fit/route.ts`, `src/app/api/businesses/route.ts` (if it filters by fit), `src/lib/config/projects.ts`

**Interfaces:**
- Consumes: `CATEGORIES`, `DEFAULT_EXCLUSION_CONFIG`, `PROJECT_CONFIG`, `PACKAGES`.
- Produces:
  - Prisma `model AppConfig { ownerId String @id; overrides Json; updatedAt DateTime @updatedAt }`
  - `type ConfigOverrides = { exclusion?: { chains?: string[]; positiveKeywords?: string[]; softNegativeKeywords?: string[]; costHardLimit?: number; sameNameLimit?: number }; categories?: { disabled?: string[]; packageOverrides?: Record<string, PackageSlug> }; projects?: { highFitThreshold?: number; mediumFitThreshold?: number; backfillMonths?: number } }`
  - `overridesSchema` (zod, `.strict()` objects, arrays of trimmed non-empty lowercase strings max 500, numbers with bounds: thresholds 0–100 with medium < high, backfillMonths 1–36, costHardLimit ≥ 0, sameNameLimit 1–100)
  - `type RuntimeConfig = { exclusion: ExclusionConfig; categories: Category[]; allCategories: (Category & { enabled: boolean; defaultPackageSlug: PackageSlug })[]; projects: { highFitThreshold: number; mediumFitThreshold: number; backfillMonths: number }; overrides: ConfigOverrides }`
  - `mergeConfig(overrides: ConfigOverrides): RuntimeConfig` (pure; `entityPatterns` always from defaults — not editable)
  - `loadConfig(ownerId: string): Promise<RuntimeConfig>` (defaults when no row or invalid JSON — log a warning)
  - `saveOverrides(ownerId: string, overrides: ConfigOverrides): Promise<RuntimeConfig>` (validates, upserts)
  - `bandFor(score: number, t?: { highFitThreshold: number; mediumFitThreshold: number }): SmbFitBand`
  - `suggestPackage(categorySlug, workType?, categories?: Category[]): PackageSlug | null`
  - `buildProjectWhere(f, thresholds)` (or whatever `filters.ts` exports — add a thresholds parameter defaulting to `PROJECT_CONFIG`)

- [ ] **Step 1: Schema + migration**

Add the model, then `npx prisma migrate dev --name app_config --skip-seed && npx prisma generate` (use `--create-only` + `migrate deploy` if the CLI refuses under the AI guard, as in Plan 3).

- [ ] **Step 2: Failing unit test for `mergeConfig`/`overridesSchema`**

`tests/unit/config/runtime.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mergeConfig, overridesSchema } from "@/lib/config/runtime";
import { CATEGORIES } from "@/lib/config/categories";
import { DEFAULT_EXCLUSION_CONFIG } from "@/lib/config/exclusion";

describe("mergeConfig", () => {
  it("returns defaults for empty overrides", () => {
    const c = mergeConfig({});
    expect(c.categories).toHaveLength(CATEGORIES.length);
    expect(c.exclusion.chains).toEqual(DEFAULT_EXCLUSION_CONFIG.chains);
    expect(c.exclusion.entityPatterns).toBe(DEFAULT_EXCLUSION_CONFIG.entityPatterns);
    expect(c.projects).toEqual({ highFitThreshold: 60, mediumFitThreshold: 30, backfillMonths: 12 });
  });
  it("replaces list fields wholesale, keeps entityPatterns, applies category disable and package override", () => {
    const c = mergeConfig({ exclusion: { chains: ["bella"] }, categories: { disabled: ["bar"], packageOverrides: { cafe: "internet_mobile" } }, projects: { highFitThreshold: 70 } });
    expect(c.exclusion.chains).toEqual(["bella"]);
    expect(c.exclusion.positiveKeywords).toEqual(DEFAULT_EXCLUSION_CONFIG.positiveKeywords);
    expect(c.categories.find((x) => x.slug === "bar")).toBeUndefined();
    expect(c.categories.find((x) => x.slug === "cafe")?.packageSlug).toBe("internet_mobile");
    expect(c.allCategories.find((x) => x.slug === "bar")).toMatchObject({ enabled: false });
    expect(c.projects.highFitThreshold).toBe(70);
    expect(c.projects.mediumFitThreshold).toBe(30);
  });
});

describe("overridesSchema", () => {
  it("normalizes strings and rejects bad values", () => {
    const ok = overridesSchema.parse({ exclusion: { chains: ["  Bella ", "", "H-E-B"] } });
    expect(ok.exclusion?.chains).toEqual(["bella", "h-e-b"]);
    expect(() => overridesSchema.parse({ projects: { highFitThreshold: 20, mediumFitThreshold: 30 } })).toThrow();
    expect(() => overridesSchema.parse({ categories: { packageOverrides: { cafe: "not_a_package" } } })).toThrow();
    expect(() => overridesSchema.parse({ categories: { disabled: ["nope"] } })).toThrow();
    expect(() => overridesSchema.parse({ bogus: 1 })).toThrow();
  });
});
```

- [ ] **Step 3: Implement `runtime.ts`**

```ts
import { z } from "zod";
import { prisma } from "@/lib/db";
import { CATEGORIES, type Category } from "./categories";
import { DEFAULT_EXCLUSION_CONFIG, type ExclusionConfig } from "./exclusion";
import { PACKAGES, type PackageSlug } from "./packages";
import { PROJECT_CONFIG } from "./projects";

const PACKAGE_SLUGS = PACKAGES.map((p) => p.slug) as [PackageSlug, ...PackageSlug[]];
const CATEGORY_SLUGS = CATEGORIES.map((c) => c.slug) as [string, ...string[]];
const wordList = z.array(z.string().transform((s) => s.trim().toLowerCase())).transform((a) => a.filter(Boolean)).pipe(z.array(z.string().max(80)).max(500));

export const overridesSchema = z
  .object({
    exclusion: z.object({ chains: wordList.optional(), positiveKeywords: wordList.optional(), softNegativeKeywords: wordList.optional(), costHardLimit: z.number().int().min(0).optional(), sameNameLimit: z.number().int().min(1).max(100).optional() }).strict().optional(),
    categories: z.object({ disabled: z.array(z.enum(CATEGORY_SLUGS)).optional(), packageOverrides: z.record(z.enum(CATEGORY_SLUGS), z.enum(PACKAGE_SLUGS)).optional() }).strict().optional(),
    projects: z
      .object({ highFitThreshold: z.number().int().min(0).max(100).optional(), mediumFitThreshold: z.number().int().min(0).max(100).optional(), backfillMonths: z.number().int().min(1).max(36).optional() })
      .strict()
      .refine((p) => (p.highFitThreshold ?? PROJECT_CONFIG.highFitThreshold) > (p.mediumFitThreshold ?? PROJECT_CONFIG.mediumFitThreshold), { message: "highFitThreshold must be greater than mediumFitThreshold" })
      .optional(),
  })
  .strict();

export type ConfigOverrides = z.infer<typeof overridesSchema>;

export type RuntimeConfig = {
  exclusion: ExclusionConfig;
  categories: Category[];
  allCategories: (Category & { enabled: boolean; defaultPackageSlug: PackageSlug })[];
  projects: { highFitThreshold: number; mediumFitThreshold: number; backfillMonths: number };
  overrides: ConfigOverrides;
};

export function mergeConfig(o: ConfigOverrides): RuntimeConfig {
  const disabled = new Set(o.categories?.disabled ?? []);
  const pk = o.categories?.packageOverrides ?? {};
  const allCategories = CATEGORIES.map((c) => ({ ...c, defaultPackageSlug: c.packageSlug, packageSlug: pk[c.slug] ?? c.packageSlug, enabled: !disabled.has(c.slug) }));
  return {
    exclusion: { ...DEFAULT_EXCLUSION_CONFIG, ...(o.exclusion ?? {}), entityPatterns: DEFAULT_EXCLUSION_CONFIG.entityPatterns },
    categories: allCategories.filter((c) => c.enabled).map(({ enabled: _e, defaultPackageSlug: _d, ...c }) => c),
    allCategories,
    projects: { highFitThreshold: o.projects?.highFitThreshold ?? PROJECT_CONFIG.highFitThreshold, mediumFitThreshold: o.projects?.mediumFitThreshold ?? PROJECT_CONFIG.mediumFitThreshold, backfillMonths: o.projects?.backfillMonths ?? PROJECT_CONFIG.backfillMonths },
    overrides: o,
  };
}

export async function loadConfig(ownerId: string): Promise<RuntimeConfig> {
  const row = await prisma.appConfig.findUnique({ where: { ownerId } });
  if (!row) return mergeConfig({});
  const parsed = overridesSchema.safeParse(row.overrides);
  if (!parsed.success) {
    console.warn(`[config] ignoring invalid AppConfig overrides for ${ownerId}: ${parsed.error.message}`);
    return mergeConfig({});
  }
  return mergeConfig(parsed.data);
}

export async function saveOverrides(ownerId: string, overrides: unknown): Promise<RuntimeConfig> {
  const o = overridesSchema.parse(overrides);
  await prisma.appConfig.upsert({ where: { ownerId }, update: { overrides: o }, create: { ownerId, overrides: o } });
  return mergeConfig(o);
}
```
(`PROJECT_CONFIG.mediumFitThreshold` was added in Plan 3 Task 7; confirm with grep.)

- [ ] **Step 4: Wire call sites**

- `bandFor(score, t = PROJECT_CONFIG)`; `scoreSmbFit(input, config, thresholds?)` passes thresholds to `bandFor`.
- `suggestPackage(categorySlug, workType?, categories: Category[] = CATEGORIES)` builds its map from the argument.
- `src/lib/projects/filters.ts`: the where-builder takes `thresholds` (default `PROJECT_CONFIG`); `src/app/api/projects/route.ts` calls `const cfg = await loadConfig(actor.id)` and passes `cfg.projects`.
- `zipSearch.ts`: at the top of `runZipSearch` load `cfg = await loadConfig(search.ownerId)`; `discover` iterates `cfg.categories`; every `scoreSmbFit(..., cfg.exclusion, cfg.projects)` and `suggestPackage(..., cfg.categories)`; the same-name limit reads `cfg.exclusion.sameNameLimit`.
- `tdlrSync.ts`: backfill window months from `cfg.projects.backfillMonths`; scoring with `cfg.exclusion`/`cfg.projects`; `promote.ts` likewise; `promote-high-fit` route uses `cfg.projects.highFitThreshold`; `tick.ts` hot-zip threshold uses `cfg.projects.highFitThreshold` (load once per tick).
- grep: `CATEGORIES\b`, `DEFAULT_EXCLUSION_CONFIG`, `PROJECT_CONFIG.highFitThreshold`, `PROJECT_CONFIG.mediumFitThreshold`, `PROJECT_CONFIG.backfillMonths`, `bandFor(` — every job/route call site goes through `cfg`; pure unit tests may keep defaults. Seeding of system tags from `CATEGORIES` stays as is.

- [ ] **Step 5: DB test**

`tests/db/runtimeConfig.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { loadConfig, saveOverrides } from "@/lib/config/runtime";
import { runZipSearch } from "@/lib/jobs/zipSearch";
import { FakeDiscoveryProvider, FakeGeocodeProvider, FakeValidationProvider, FakeRegistryProvider, FakeEnrichmentProvider, fakeFetcher } from "@/lib/providers/fake";

const OWNER = "test-runtime-config-owner";
async function cleanup() {
  await prisma.appConfig.deleteMany({ where: { ownerId: OWNER } });
  await prisma.activityLog.deleteMany({ where: { ownerId: OWNER } });
  await prisma.contact.deleteMany({ where: { ownerId: OWNER } });
  await prisma.searchBusiness.deleteMany({ where: { search: { ownerId: OWNER } } });
  await prisma.search.deleteMany({ where: { ownerId: OWNER } });
  await prisma.businessTag.deleteMany({ where: { business: { ownerId: OWNER } } });
  await prisma.business.deleteMany({ where: { ownerId: OWNER } });
}
beforeEach(cleanup);
afterAll(cleanup);

describe("runtime config", () => {
  it("defaults without a row, round-trips overrides", async () => {
    expect((await loadConfig(OWNER)).projects.highFitThreshold).toBe(60);
    await saveOverrides(OWNER, { projects: { highFitThreshold: 75 }, exclusion: { chains: ["bella"] } });
    const c = await loadConfig(OWNER);
    expect(c.projects.highFitThreshold).toBe(75);
    expect(c.exclusion.chains).toEqual(["bella"]);
  });
  it("a disabled category is not searched and an added chain excludes the business", async () => {
    await saveOverrides(OWNER, { categories: { disabled: ["nail_salon"] }, exclusion: { chains: ["bella nails"] } });
    const discovery = new FakeDiscoveryProvider();
    const search = await prisma.search.create({ data: { ownerId: OWNER, zip: "77084" } });
    await runZipSearch(search.id, { providers: { geocode: new FakeGeocodeProvider(), discovery, validation: new FakeValidationProvider(), registry: new FakeRegistryProvider(), enrichment: new FakeEnrichmentProvider(), fetcher: fakeFetcher }, log: () => {} } as never);
    expect(discovery.queries.some((q) => q.includes("nail salon"))).toBe(false); // add a `queries: string[]` recorder to the fake if absent
    const bella = await prisma.business.findFirst({ where: { ownerId: OWNER, name: { contains: "Bella" } } });
    if (bella) expect(bella.exclusion).toBe("enterprise");
  });
});
```
(The fake discovery yields "Bella Nails & Spa" only under the nail-salon category in the current fixture; if disabling that category means Bella never appears, replace the chain assertion with a second search where the category is enabled and only the chain override is set. Make the test assert the real behaviour, not a tautology.)

- [ ] **Step 6: Verify, commit**

```bash
npm test && npm run test:db && npx tsc --noEmit && npm run lint
git add -A
git commit -m "feat(config): AppConfig overrides merged over defaults; jobs and routes read loadConfig

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Settings page and API

**Files:**
- Create: `src/app/api/settings/route.ts`, `src/app/api/settings/providers/[provider]/route.ts`, `src/app/api/settings/config/route.ts`, `src/components/settings/types.ts`, `src/components/settings/ProviderKeysCard.tsx`, `src/components/settings/CategoriesCard.tsx`, `src/components/settings/ExclusionCard.tsx`, `src/components/settings/ProjectsCard.tsx`, `src/components/settings/SettingsView.tsx`, `tests/db/settings.test.ts`, `tests/e2e/settings.spec.ts`
- Modify: `src/app/settings/page.tsx`

**Interfaces:**
- Consumes: `loadConfig`, `saveOverrides`, `overridesSchema`, `RuntimeConfig` (Task 6); `encryptString`; `budgetStatus`; `getProviderKey`.
- Produces:
  - `GET /api/settings` → `SettingsPayload = { providers: { provider: "google" | "apollo"; label: string; source: "env" | "stored" | "none"; enabled: boolean; dailyBudget: number; usedToday: number }[]; config: { exclusion: { chains: string[]; positiveKeywords: string[]; softNegativeKeywords: string[]; costHardLimit: number; sameNameLimit: number }; categories: { slug: string; label: string; enabled: boolean; packageSlug: PackageSlug; defaultPackageSlug: PackageSlug }[]; projects: { highFitThreshold: number; mediumFitThreshold: number; backfillMonths: number } }; packages: { slug: PackageSlug; label: string }[]; defaults: { exclusion: {...same shape}; projects: {...} } }`
  - `PUT /api/settings/providers/[provider]` body `{ key?: string | null; enabled?: boolean; dailyBudget?: number }` (`key: string` stores encrypted, `key: null` clears, absent = unchanged; `dailyBudget` 1–100000) → `{ provider }` (the updated provider row of the payload shape). `400` unknown provider. Never echoes the key.
  - `PUT /api/settings/config` body = `ConfigOverrides` (full replacement) → `{ config }`; `400` with zod message on invalid.
  - Testids: `provider-<p>-status`, `provider-<p>-key`, `provider-<p>-save`, `provider-<p>-clear`, `provider-<p>-enabled`, `provider-<p>-budget`, `settings-config-save`, `exclusion-chains`, `category-row`, `projects-high`.

- [ ] **Step 1: DB test for the API modules**

`tests/db/settings.test.ts` — call the route handlers directly (import `GET`/`PUT`, build `Request`s with JSON bodies and a `ctx = { params: Promise.resolve({ provider: "apollo" }) }`):

- PUT key `"abc123"` → GET shows `source: "stored"`, response contains no `"abc123"` and no `encryptedKey`; `prisma.providerConfig.findUnique` row's `encryptedKey` decrypts to `abc123` with `APP_SECRET`.
- PUT `{ key: null }` → `source: "none"` (with `APOLLO_API_KEY` unset in the test env; if the env var is set, skip with a note).
- PUT `{ dailyBudget: 50, enabled: false }` → GET shows them; `budgetStatus("apollo").limit === 50`.
- PUT config `{ projects: { highFitThreshold: 20, mediumFitThreshold: 30 } }` → 400; PUT `{ exclusion: { chains: ["bella"] } }` → 200 and `loadConfig` reflects it.
- Unknown provider → 400.

Cleanup: `providerConfig.deleteMany({ where: { provider: { in: ["google", "apollo"] } } })` only for rows this test created — to avoid clobbering budgets used by other DB tests, snapshot the rows in `beforeAll` and restore them in `afterAll`.

- [ ] **Step 2: Implement the API**

`src/app/api/settings/route.ts` (GET):

```ts
const PROVIDERS = [{ provider: "google", label: "Google Places" }, { provider: "apollo", label: "Apollo.io" }] as const;

export const GET = handle(async () => {
  const actor = await getActor();
  const cfg = await loadConfig(actor.id);
  const providers = await Promise.all(PROVIDERS.map(async (p) => {
    const row = await prisma.providerConfig.findUnique({ where: { provider: p.provider } });
    const env = process.env[p.provider === "google" ? "GOOGLE_MAPS_API_KEY" : "APOLLO_API_KEY"];
    const status = await budgetStatus(p.provider);
    return { ...p, source: env ? "env" : row?.encryptedKey ? "stored" : "none", enabled: row?.enabled ?? true, dailyBudget: status.limit, usedToday: status.used };
  }));
  const { entityPatterns: _e, ...exclusion } = cfg.exclusion;
  const { entityPatterns: _d, ...defaultExclusion } = DEFAULT_EXCLUSION_CONFIG;
  return json({
    providers,
    config: { exclusion, categories: cfg.allCategories.map(({ slug, label, enabled, packageSlug, defaultPackageSlug }) => ({ slug, label, enabled, packageSlug, defaultPackageSlug })), projects: cfg.projects },
    packages: PACKAGES,
    defaults: { exclusion: defaultExclusion, projects: { highFitThreshold: PROJECT_CONFIG.highFitThreshold, mediumFitThreshold: PROJECT_CONFIG.mediumFitThreshold, backfillMonths: PROJECT_CONFIG.backfillMonths } },
  });
});
```

`providers/[provider]/route.ts` (PUT): zod `{ key: z.string().min(8).max(512).optional().nullable(), enabled: z.boolean().optional(), dailyBudget: z.number().int().min(1).max(100_000).optional() }`; provider must be `google` or `apollo` else 400; `APP_SECRET` missing → 500; upsert `providerConfig` with `encryptedKey: key === null ? null : key !== undefined ? encryptString(key, secret) : undefined`, `enabled`, `dailyBudget`; return the recomputed provider entry (same shape as GET).

`config/route.ts` (PUT): `const cfg = await saveOverrides(actor.id, await req.json())` inside try/catch mapping `ZodError` → `ApiError(400, firstIssueMessage)`; respond with the same `config` shape as GET.

- [ ] **Step 3: UI**

`SettingsView` (client) fetches `/api/settings` once, holds `SettingsPayload`, renders the four cards, and refetches after any save. Cards:

- **ProviderKeysCard**: per provider a row with label, status badge (`From environment` / `Stored` / `Not configured`), used/limit today, `Input type="password"` (`provider-<p>-key`, placeholder "Paste API key"), Save (`provider-<p>-save`, disabled when empty or env source), Clear (`provider-<p>-clear`, only when stored), `Checkbox` enabled (`provider-<p>-enabled`), `Input type="number"` daily budget (`provider-<p>-budget`) saved on blur. Toasts "Key saved" / "Key cleared" / "Budget saved". Never pre-fill the key input.
- **CategoriesCard**: rows `category-row` with label, `Checkbox` enabled, `Select` package (`items` = packages; `onValueChange` null-guarded), "default" hint when overridden. Local state → included in the config save.
- **ExclusionCard**: three `Textarea`s one term per line (`exclusion-chains`, `exclusion-positive`, `exclusion-soft`), number inputs cost hard limit and same-name limit, note "Government/education/health-system patterns are fixed in code."
- **ProjectsCard**: high/medium fit thresholds (`projects-high`, `projects-medium`), backfill months (`projects-backfill`).
- One **Save configuration** button (`settings-config-save`) builds `ConfigOverrides` from local state — only fields that differ from `defaults` are sent (so "Reset to defaults" = send `{}`) — `PUT /api/settings/config`; shows the 400 message on error; toast "Configuration saved". A **Reset to defaults** button sends `{}` after `confirm()`.

`src/app/settings/page.tsx` renders `<SettingsView />` with the h1.

- [ ] **Step 4: e2e**

`tests/e2e/settings.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { unlock } from "./helpers";

test.describe.configure({ mode: "serial" });

test("store an Apollo key and budget", async ({ page }) => {
  await unlock(page);
  await page.goto("/settings");
  await expect(page.getByTestId("provider-apollo-status")).toHaveText(/Not configured|From environment/);
  await page.getByTestId("provider-apollo-key").fill("e2e-apollo-key-1234");
  await page.getByTestId("provider-apollo-save").click();
  await expect(page.getByText("Key saved")).toBeVisible();
  await expect(page.getByTestId("provider-apollo-status")).toHaveText("Stored");
  await page.getByTestId("provider-apollo-budget").fill("50");
  await page.getByTestId("provider-apollo-budget").blur();
  await expect(page.getByText("Budget saved")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("provider-apollo-budget")).toHaveValue("50");
});

test("config save is validated and persisted", async ({ page }) => {
  await unlock(page);
  await page.goto("/settings");
  await page.getByTestId("projects-high").fill("20");
  await page.getByTestId("projects-medium").fill("30");
  await page.getByTestId("settings-config-save").click();
  await expect(page.getByText(/greater than/)).toBeVisible();
  await page.getByTestId("projects-high").fill("70");
  await page.getByTestId("exclusion-chains").fill("bella nails\nstarbucks");
  await page.getByTestId("settings-config-save").click();
  await expect(page.getByText("Configuration saved")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("projects-high")).toHaveValue("70");
  await expect(page.getByTestId("exclusion-chains")).toHaveValue(/bella nails/);
});
```
Global setup already deletes `providerConfig` and must also delete `appConfig` — add `await prisma.appConfig.deleteMany();` to `tests/e2e/global-setup.ts`. The stored fake key never reaches the network (fake mode).

- [ ] **Step 5: Verify, commit**

```bash
npm test && npm run test:db && npx tsc --noEmit && npm run lint && npm run test:e2e   # 13 passed
git add -A
git commit -m "feat(settings): provider keys, budgets, editable categories/exclusions/thresholds; e2e

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Plan 3 deferrals

**Files:**
- Modify: `src/lib/scanner/state.ts` (`readScanner`), `src/lib/scanner/schedule.ts` (`applyScheduleUpdate`), `src/lib/scanner/tick.ts` (failure accounting, website-recheck concurrency), `src/lib/scanner/window.ts` (`nextWindowStart`), `src/lib/jobs/websiteRecheck.ts`, `src/lib/extract/website.ts` (`extractWebsiteContacts` hook), `src/lib/jobs/zipSearch.ts` (`scrapeOne` passes the hook)
- Create/extend: `tests/db/scannerDeferrals.test.ts`, `tests/unit/scanner/nextWindowStart.test.ts`, extend `tests/db/scannerTick.test.ts`, `tests/db/websiteRecheck.test.ts`

Each item is independent; implement in this order, each with its test first.

- [ ] **D1: `readScanner` first-poll race.** Wrap the `ScannerState` and `ScanSchedule` creates in `upsertIgnoringConflict` and re-read afterwards. Test: `Promise.all([readScanner(o), readScanner(o), readScanner(o)])` on a fresh owner resolves without throwing and leaves exactly one row of each.

- [ ] **D2: `applyScheduleUpdate` atomicity.** Run read + validate + upsert inside `prisma.$transaction(async (tx) => ..., { isolationLevel: "Serializable" })`, retrying once on Prisma error `P2034`. Test: two concurrent updates `{ windowStart: T+10h }` and `{ windowEnd: T+5h }` against a row `{ windowStart: T, windowEnd: T+20h }` — afterwards the row never has `windowEnd < windowStart` (one of the two must have been rejected with 400).

- [ ] **D3: failure accounting per item, not per retry.** In `tick.ts`, count a failed scanner-origin search toward `consecutiveFailures` only when its `zip:<zip>` key was **not already present** in `skipUntil` before this tick (the skip entry doubles as the "already counted" marker for 6 h). Test (extend `scannerTick.test.ts`): the same search observed failed on three consecutive ticks yields `consecutiveFailures === 1` and no auto-pause; three different failed zips still auto-pause.

- [ ] **D4: website re-check counted toward `maxConcurrentJobs`.** When the tick enqueues `website_recheck`, set `ScannerState.currentJobId = "website_recheck:<ISO now>"`; `runWebsiteRecheck` clears `currentJobId` (only if it still starts with `website_recheck:`) in a `finally`. In the tick, `runningScannerJobs` adds 1 while `currentJobId` starts with `website_recheck:` and its timestamp is within `QUEUE_OPTIONS.websiteRecheck.expireInSeconds`. Test: with `maxConcurrentJobs: 1`, a state carrying a fresh `website_recheck:` marker → tick returns `busy` and enqueues nothing; a stale marker (2 h old) is ignored.

- [ ] **D5: DST-safe `nextWindowStart`.** Replace the "+24 h" walk with a local-date walk: compute `{ y, m, d }` in the schedule timezone, advance the calendar day, and convert `(y, m, d, HH, mm, tz)` to a UTC instant with a two-pass Intl offset correction:

```ts
export function utcForLocal(y: number, m: number, d: number, hh: number, mm: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const offsetAt = (t: number) => {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(t));
    const g = (k: string) => Number(p.find((x) => x.type === k)!.value);
    return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute")) - t;
  };
  let t = guess - offsetAt(guess);
  t = guess - offsetAt(t);
  return new Date(t);
}
```
Unit test (`tests/unit/scanner/nextWindowStart.test.ts`): timezone `America/Chicago`, daily start `09:00`, now = 2026-03-07T20:00:00-06:00 (day before the spring-forward) → next start is 2026-03-08T09:00:00-05:00 = `2026-03-08T14:00:00Z`; and now = 2026-10-31T20:00-05:00 → 2026-11-01T09:00-05:00 = `2026-11-01T15:00:00Z`... check: 2026-11-01 is the fall-back date; 09:00 CST = 15:00Z. Also a plain day-off skip (Saturday → Monday).

- [ ] **D6: pause between website fetches.** `extractWebsiteContacts(websiteUrl, fetcher, opts?: { beforeFetch?: () => Promise<void> })` awaits `opts.beforeFetch` before every page fetch (home and candidate pages); `scrapeOne` passes `() => checkPause(deps)`. Test (extend `websiteRecheck.test.ts`): a `shouldPause` that flips to true after the first fetch causes `JobPausedError` before the second candidate page is requested (count fetcher calls).

- [ ] **Verify, commit**

```bash
npm test && npm run test:db && npx tsc --noEmit && npm run lint
git add -A
git commit -m "fix(scanner): first-poll race, schedule update atomicity, per-item failure counting, recheck concurrency, DST-safe next window, pause between fetches

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Dark mode

**Files:**
- Create: `src/components/theme/ThemeToggle.tsx`
- Modify: `src/app/layout.tsx`, `src/app/globals.css`, `src/components/nav/Navbar.tsx`, `package.json` (`next-themes`)

- [ ] **Step 1:** `npm i next-themes@^0.4`. In `layout.tsx` wrap children with `<ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>` and add `suppressHydrationWarning` to `<html>`. In `globals.css` confirm Tailwind 4's dark variant is class-based: `@custom-variant dark (&:where(.dark, .dark *));` (add if absent) and that shadcn's `.dark` token block exists (it does if `components.json` was generated with the default theme — verify; otherwise add the standard `.dark { --background: ...; }` block from shadcn's Base UI docs).
- [ ] **Step 2:** `ThemeToggle` (client): a `Button variant="ghost" size="icon" aria-label="Toggle theme"` cycling light → dark → system, rendering a sun/moon glyph (text glyphs are fine: ☀︎ / ☾ / ◐), mounted-guarded (`useEffect` mounted flag) to avoid hydration mismatch. Place it in the navbar's reserved right-hand slot next to the scanner pill.
- [ ] **Step 3:** Grep components for hard-coded light colours (`bg-white`, `text-neutral-900`, `bg-neutral-50`) and add `dark:` counterparts where they are not already using shadcn tokens (`bg-background`, `text-foreground`, `bg-card`, `text-muted-foreground`). Do not restyle beyond that.
- [ ] **Step 4:** Verify visually in the dev server (both modes on `/`, `/leads`, `/scanner`, `/settings`), then `npm run build` succeeds. Commit `feat(ui): dark mode toggle`.

---

### Task 10: Railway deployment (Dockerfile, two services, health check, docs)

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `railway.json`
- Modify: `package.json` (scripts + move `tsx` and `prisma` to `dependencies`), `README.md` (new "Deploy to Railway" section), `.github/workflows/ci.yml` (docker build job), `.env.example` (production notes)

- [ ] **Step 1: Dockerfile**

```dockerfile
# syntax=docker/dockerfile:1
FROM node:22.22.3-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate && npm run build && npm prune --omit=dev

FROM node:22.22.3-bookworm-slim AS runner
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/next.config.ts ./
COPY --from=build /app/src ./src
COPY --from=build /app/tsconfig.json ./
EXPOSE 3000
CMD ["npm", "run", "start:web"]
```
`.dockerignore`: `node_modules`, `.next`, `.next-e2e`, `.git`, `.superpowers`, `docs`, `tests`, `playwright-report`, `test-results`, `.env*`, `*.md`.

`package.json` scripts:
- `"start:web": "prisma migrate deploy && next start -p ${PORT:-3000}"`
- `"start:worker": "node --import=tsx src/worker/index.ts"`
- Move `tsx` and `prisma` from `devDependencies` to `dependencies` (`@prisma/client` already is). Keep `cross-env` dev-only (production scripts above don't use it).

`railway.json`:

```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": { "builder": "DOCKERFILE", "dockerfilePath": "Dockerfile" },
  "deploy": { "startCommand": "npm run start:web", "healthcheckPath": "/api/health", "healthcheckTimeout": 120, "restartPolicyType": "ON_FAILURE", "restartPolicyMaxRetries": 5 }
}
```
The worker service uses the same repo and Dockerfile with its **Start Command** overridden in the Railway dashboard to `npm run start:worker` (document this; Railway config-as-code is per service, so the JSON describes the web service).

- [ ] **Step 2: Local verification**

```bash
docker build -t sdr-app .
docker run --rm -d --name sdr-web -p 3200:3000 \
  -e DATABASE_URL=postgresql://postgres:sdr@host.docker.internal:5432/sdr \
  -e APP_SECRET=local-docker-secret-at-least-32-characters-long -e APP_PASSPHRASE=change-me \
  -e PROVIDER_MODE=fake -e JOB_MODE=queue sdr-app
sleep 15 && curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3200/api/health   # expect 200
docker logs sdr-web | tail -5
docker run --rm -e DATABASE_URL=postgresql://postgres:sdr@host.docker.internal:5432/sdr -e APP_SECRET=x -e PGBOSS_RECREATE_QUEUES=0 sdr-app timeout 20 npm run start:worker || true   # expect "worker ready" in output
docker stop sdr-web
```
(`migrate deploy` against the dev DB is a no-op since it is already migrated; that is acceptable here.) If `host.docker.internal` is unavailable, use the Docker network of the compose Postgres (`--network sdr_default -e DATABASE_URL=postgresql://postgres:sdr@db:5432/sdr`).

- [ ] **Step 3: CI docker job**

Add a second job to `ci.yml`:

```yaml
  docker:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/build-push-action@v6
        with:
          context: .
          push: false
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

- [ ] **Step 4: README "Deploy to Railway"**

Cover: create a project with a Postgres plugin; two services from this repo (web: default start command from `railway.json`, worker: start command `npm run start:worker`); shared variables `DATABASE_URL` (from the plugin), `APP_SECRET` (32+ random chars), `APP_PASSPHRASE`, `PROVIDER_MODE=real`, `JOB_MODE=queue`, `GOOGLE_MAPS_API_KEY` (or paste in Settings), `APOLLO_API_KEY` (or paste in Settings), optional `GOOGLE_DAILY_BUDGET`/`APOLLO_DAILY_BUDGET`; health check `/api/health`; migrations run at web start (`prisma migrate deploy`); the pg-boss queue-policy note (`PGBOSS_RECREATE_QUEUES=1` once on the worker if the database predates Plan 3, then remove it); the passphrase limiter is per instance (run one web instance); scraping happens from Railway's egress IPs. Also add the `.env.example` comment block for production values.

- [ ] **Step 5: Verify, commit**

```bash
npm test && npm run test:db && npx tsc --noEmit && npm run lint && npm run build
git add -A
git commit -m "chore(deploy): Dockerfile, railway.json, production start scripts, CI docker build, Railway docs

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Done criteria for Plan 4

- Unit, DB, and e2e suites pass; e2e = 13 tests against the production build; CI green including the docker build job.
- With an Apollo key in Settings (or env), "Enrich with Apollo" on a lead adds named decision-makers with email/LinkedIn as Contacts, MX-validates, re-scores, and stamps `lastEnrichedAt`; each Apollo call counts against the Apollo daily budget; exhaustion pauses with a clear activity message.
- Settings persists provider keys (encrypted, never echoed), budgets, enabled flags, category enable/package overrides, exclusion lists, fit thresholds, and TDLR backfill months; jobs and routes honour them.
- The scraper and website checker refuse private/loopback/link-local/metadata targets on every hop and cap bodies while streaming; wrong passphrases are throttled (5 per 15 min per client).
- All six Plan 3 deferrals are closed with tests.
- `docker build` succeeds and the container serves `/api/health`; README documents the Railway setup.

## Out of scope (v1, per spec 12 and this plan)

Real multi-user auth; Apollo phone reveal (needs a webhook); multi-instance rate limiting; editable `entityPatterns`; automatic enrichment from the Scanner (enrichment stays manual because it costs credits).
