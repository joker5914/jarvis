# SDR Lead Gen Dashboard — Plan 5: Closing Hygiene (Plan 4 deferrals)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every item deferred from Plan 4 so the hosted v1 is correct against the live Apollo API, hardened against DNS rebinding, runs as a non-root container, and has its dependency advisories documented.

**Architecture:** Small, independent changes: the Apollo provider switches to Apollo's documented query-string contract and a two-step Organization Search fallback for businesses without a domain; `safeFetch` pins the connection to the address it validated (undici `Agent` with a custom `lookup`); the enrich worker handler becomes a pure, unit-testable function; the Dockerfile gains a non-root user and a digest-pinned base image; the bulk API and BulkBar get their two small polish fixes; CI gains an audit gate at the critical level and the README documents the advisories the version pins block.

**Tech Stack:** Same as Plans 1–4 (Next.js 15.5, Prisma 6.19, pg-boss 12.32, zod 4, Vitest 5, Playwright, Node 22.22.3). New direct dependency: `undici` (already present transitively; used for a version-consistent `fetch` + `Agent` pair).

**Spec:** `docs/superpowers/specs/2026-09-15-sdr-lead-gen-dashboard-design.md` — 3.2 (EnrichmentProvider, budget wrapper), 5.2 (enrich fallback "name + city"), 5.5 (errors), plus the Plan 4 ledger deferrals in `.superpowers/sdd/2026-09-16-plan4-apollo-settings-deploy/progress.md` (final lines).

## Global Constraints

- Node 22.22.3 via nvm (`export PATH="/c/Users/cgill/AppData/Roaming/nvm/v22.22.3:$PATH"` before npm commands). Pinned majors unchanged (Next 15.5, Prisma 6, pg-boss 12, zod 4); **no Next 16 / Prisma 7 upgrade** even though `npm audit fix --force` proposes it.
- shadcn/ui is the **Base UI generation**: no `asChild`; `render` prop; `Select` takes `items`; `Checkbox` uses `onCheckedChange(boolean)`.
- Owner via `getActor()` in every route handler and server component; `"local-user"` only in `src/lib/actor.ts`, schema defaults, seed, tests.
- Every Apollo HTTP call inside `withBudget("apollo")`; keys only in the `x-api-key` header, never in URLs, logs, errors, or responses; `PROVIDER_MODE=fake` never touches the network.
- Scraper/website checker: private/loopback/link-local/multicast/metadata refused on every hop **and the connection goes to the validated address**; http/https only; streamed body cap.
- Browser suite stays at **13** tests; unit/db suites only grow.
- Commit after every task with a conventional-commit message ending in `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; author flags `git -c user.name="cgillett5914" -c user.email="cgillett5914@gmail.com"`. Stop servers by PID, never `taskkill /IM node.exe`. `npx tsc --noEmit` is the source of truth over editor diagnostics. Never reset the dev database.

## Apollo contract facts (fetched from docs.apollo.io on 2026-09-16)

- People search `POST https://api.apollo.io/api/v1/mixed_people/api_search`: **all parameters in the query string** (arrays as repeated `name[]=value`), no JSON body. Parameters used: `q_organization_domains_list[]`, `organization_ids[]`, `person_titles[]`, `include_similar_titles`, `person_seniorities[]`, `per_page`, `page`. `q_keywords` exists but there is **no company-name parameter**. 0 credits; no emails in results.
- Organization search `POST https://api.apollo.io/api/v1/mixed_companies/search`: query string `q_organization_name` (partial match), `organization_locations[]`, `per_page`, `page`; response `{ organizations: [{ id, name, website_url, primary_domain, ... }] }`; **1 credit per page**; 600/h.
- People enrichment `POST https://api.apollo.io/api/v1/people/match?id=…&reveal_personal_emails=false&reveal_phone_number=false` (unchanged from Plan 4).

## File structure

```
src/components/leads/BulkBar.tsx              busy guard on Enrich (and the existing apply path)
src/app/api/businesses/bulk/route.ts          not-configured 409 carries settingsHref
src/lib/providers/apollo.ts                   query-string contract; org-search fallback; searchOrganization()
src/lib/providers/types.ts                    EnrichmentProvider.searchPeople unchanged (fallback is internal)
src/lib/net/ssrf.ts                           assertSafeUrl returns { url, addresses }
src/lib/net/safeFetch.ts                      pinned dispatcher via undici Agent lookup
src/lib/jobs/enrichHandler.ts                 handleEnrichJob(job, deps) → "done" | "skipped"
src/worker/index.ts                           uses handleEnrichJob
Dockerfile                                    digest-pinned base, non-root USER node
.github/workflows/ci.yml                      npm audit --omit=dev --audit-level=critical
README.md                                     "Known advisories" section
package.json                                  + undici
tests/unit/providers/apollo.test.ts, tests/unit/net/{ssrf,safeFetch}.test.ts, tests/unit/jobs/enrichHandler.test.ts, tests/db/businessEnrichRoute.test.ts
```

---

### Task 1: Bulk enrich polish (double-click guard, settingsHref on 409)

**Files:**
- Modify: `src/components/leads/BulkBar.tsx`, `src/app/api/businesses/bulk/route.ts`
- Test: `tests/db/businessEnrichRoute.test.ts`

**Interfaces:**
- Produces: bulk not-configured response `409 { error: "Apollo API key is not configured", settingsHref: "/settings" }` (same shape as the disabled 409 and the single route).

- [ ] **Step 1: Failing DB test**

In `tests/db/businessEnrichRoute.test.ts` add, next to the existing bulk 409 test for the disabled provider, a test that sets `PROVIDER_MODE=real` (via `vi.stubEnv`) with no `APOLLO_API_KEY` and no stored key, POSTs `{ ids: [b.id], enrich: true }` to the bulk route, and asserts status 409 and `body.settingsHref === "/settings"`. Restore env in `finally`/`vi.unstubAllEnvs()`.

- [ ] **Step 2: Route**

Replace `throw new ApiError(409, "Apollo API key is not configured")` with `return json({ error: "Apollo API key is not configured", settingsHref: "/settings" }, 409);` (mirroring the disabled branch two lines below).

- [ ] **Step 3: BulkBar guard**

In `BulkBar.tsx` add `const [busy, setBusy] = useState(false);` and wrap `enrichSelected` (and the existing `apply` helper) so they `if (busy) return; setBusy(true); try { … } finally { setBusy(false); }`; render every action button with `disabled={busy}`. Keep all testids.

- [ ] **Step 4: Verify, commit**

```bash
npm run test:db && npx tsc --noEmit && npm run lint
git add -A && git commit -m "fix(leads): bulk enrich busy guard; settingsHref on not-configured 409

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Apollo request contract and Organization Search fallback

**Files:**
- Modify: `src/lib/providers/apollo.ts`, `tests/unit/providers/apollo.test.ts`, `src/lib/providers/fake.ts` (counter only), `README.md` (one paragraph on enrichment cost)

**Interfaces:**
- Consumes: `withBudget`, `getProviderKey`, `ENRICH_CONFIG`.
- Produces: `ApolloEnrichmentProvider.searchOrganization(name: string, city: string | null): Promise<{ id: string; primaryDomain: string | null } | null>` (public for tests); `searchPeople` unchanged signature; `FakeEnrichmentProvider.calls.orgSearch` counter (fake never needs it but keeps parity).

- [ ] **Step 1: Failing unit tests (replace the body-based assertions)**

In `tests/unit/providers/apollo.test.ts`:

```ts
function params(url: string) { return new URL(url).searchParams; }

it("sends people search parameters in the query string (arrays as name[])", async () => {
  mockFetch(() => json({ total_entries: 0, people: [] }));
  await new ApolloEnrichmentProvider().searchPeople({ domain: "bellanails.com", orgName: "Bella Nails", city: "Houston" }, 5);
  const u = new URL(calls[0].url);
  expect(u.origin + u.pathname).toBe("https://api.apollo.io/api/v1/mixed_people/api_search");
  expect(u.searchParams.getAll("q_organization_domains_list[]")).toEqual(["bellanails.com"]);
  expect(u.searchParams.getAll("person_titles[]")).toContain("owner");
  expect(u.searchParams.getAll("person_seniorities[]")).toContain("owner");
  expect(u.searchParams.get("include_similar_titles")).toBe("true");
  expect(u.searchParams.get("per_page")).toBe("5");
  expect(u.searchParams.get("page")).toBe("1");
  expect(calls[0].init.body).toBeUndefined();
  expect((calls[0].init.headers as Record<string, string>)["x-api-key"]).toBe("test-key");
});

it("without a domain: organization search by name + city, then people by organization_ids[]", async () => {
  mockFetch((c) => c.url.includes("/mixed_companies/search")
    ? json({ organizations: [{ id: "org1", name: "Bella Nails", primary_domain: "bellanails.com" }] })
    : json({ total_entries: 1, people: [{ id: "p1", first_name: "Maria", title: "Owner", has_email: true }] }));
  const people = await new ApolloEnrichmentProvider().searchPeople({ domain: null, orgName: "Bella Nails", city: "Houston" }, 5);
  const org = new URL(calls[0].url);
  expect(org.pathname).toBe("/api/v1/mixed_companies/search");
  expect(org.searchParams.get("q_organization_name")).toBe("Bella Nails");
  expect(org.searchParams.getAll("organization_locations[]")).toEqual(["Houston"]);
  expect(org.searchParams.get("per_page")).toBe("1");
  const ppl = new URL(calls[1].url);
  expect(ppl.searchParams.getAll("organization_ids[]")).toEqual(["org1"]);
  expect(ppl.searchParams.has("q_organization_domains_list[]")).toBe(false);
  expect(people.map((p) => p.apolloId)).toEqual(["p1"]);
});

it("without a domain and no organization match: returns [] after one org-search call", async () => {
  mockFetch(() => json({ organizations: [] }));
  expect(await new ApolloEnrichmentProvider().searchPeople({ domain: null, orgName: "Nope", city: null }, 5)).toEqual([]);
  expect(calls).toHaveLength(1);
});
```
Keep the ranking, 422, 429, and `enrichPerson` tests (adjust the 422 test to the new URL form). Delete the old `q_keywords` test.

- [ ] **Step 2: Implement**

In `apollo.ts`:

```ts
function qs(params: Record<string, string | number | boolean | string[] | undefined>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) for (const item of v) u.append(`${k}[]`, item);
    else u.set(k, String(v));
  }
  return u.toString();
}

async function post<T>(key: string, path: string, params: Record<string, unknown>): Promise<{ status: number; data: T | null }> {
  const res = await fetch(`${BASE}${path}?${qs(params as never)}`, { method: "POST", headers: { accept: "application/json", "x-api-key": key } });
  if (res.status === 422) return { status: 422, data: null };
  if (!res.ok) throw new Error(`Apollo ${path} HTTP ${res.status}`);
  return { status: res.status, data: (await res.json()) as T };
}

async searchOrganization(name: string, city: string | null) {
  const key = await requireKey();
  const r = await withBudget("apollo", () => post<{ organizations?: { id: string; primary_domain?: string | null }[] }>(key, "/mixed_companies/search", { q_organization_name: name, organization_locations: city ? [city] : undefined, per_page: 1, page: 1 }));
  const org = r.data?.organizations?.[0];
  return org ? { id: org.id, primaryDomain: org.primary_domain ?? null } : null;
}

async searchPeople(q, max) {
  const key = await requireKey();
  const base = { person_titles: [...ENRICH_CONFIG.preferredTitles], include_similar_titles: true, person_seniorities: [...ENRICH_CONFIG.seniorities], per_page: max, page: 1 };
  let filter: Record<string, unknown>;
  if (q.domain) filter = { q_organization_domains_list: [q.domain] };
  else {
    const org = await this.searchOrganization(q.orgName, q.city);
    if (!org) return [];
    filter = org.primaryDomain ? { q_organization_domains_list: [org.primaryDomain] } : { organization_ids: [org.id] };
  }
  const r = await withBudget("apollo", () => post<{ people?: SearchPerson[] }>(key, "/mixed_people/api_search", { ...base, ...filter }));
  … existing mapping + ranking on r.data?.people …
}
```
(Prefer the organization's `primary_domain` when present — it makes the second test's expectation `organization_ids[]` apply only when `primary_domain` is absent; adjust the test fixture to omit `primary_domain` so both branches are covered: one test with `primary_domain` → domains list, one without → `organization_ids[]`.)

`enrichPerson` stays as is. Add `orgSearch: 0` to `FakeEnrichmentProvider.calls` (never incremented; parity only).

README (Apollo paragraph): "Businesses without a usable website domain cost one extra Apollo credit for an Organization Search before the people lookup."

- [ ] **Step 3: Verify, commit**

```bash
npm test && npx tsc --noEmit && npm run lint && npm run test:db
git add -A && git commit -m "fix(apollo): query-string contract; Organization Search fallback for businesses without a domain

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: DNS-rebinding hardening — connect to the validated address

**Files:**
- Modify: `src/lib/net/ssrf.ts`, `src/lib/net/safeFetch.ts`, `package.json` (+ `undici`), `tests/unit/net/ssrf.test.ts`, `tests/unit/net/safeFetch.test.ts`

**Interfaces:**
- Produces: `assertSafeUrl(raw, resolve?)` now returns `Promise<{ url: URL; addresses: string[] }>` (`addresses` empty for IP-literal hosts); `pinnedDispatcher(hostname: string, addresses: string[]): Dispatcher` (undici `Agent` whose `connect.lookup` answers only for `hostname` with the given addresses, `all: true` shape); `safeFetch` passes `dispatcher` to undici's `fetch` (default `fetchImpl` becomes undici's `fetch`; tests keep injecting `fetchImpl`).

- [ ] **Step 1: Install**

`npm i undici@^7` (direct dependency; use undici's own `fetch` so the `Agent` and the fetch implementation share a version — do not pass an npm-undici `Agent` to Node's global fetch).

- [ ] **Step 2: Failing tests**

`ssrf.test.ts`: update existing calls to destructure `{ url }`; add: a resolved public host returns `addresses` equal to the resolver's list; an IP-literal host returns `addresses: []`.

`safeFetch.test.ts`:

```ts
it("pins the connection to the validated addresses via a dispatcher lookup", async () => {
  let seen: unknown;
  const f = vi.fn(async (_u: string, init: RequestInit & { dispatcher?: unknown }) => { seen = init.dispatcher; return new Response("ok", { status: 200 }); }) as unknown as typeof fetch;
  await safeFetch("https://example.com/", {}, { resolve: async () => ["93.184.216.34"], fetchImpl: f });
  expect(seen).toBeDefined();
  const d = seen as { lookupFor: (host: string) => Promise<{ address: string; family: number }[]> };
  await expect(d.lookupFor("example.com")).resolves.toEqual([{ address: "93.184.216.34", family: 4 }]);
  await expect(d.lookupFor("other.example")).rejects.toThrow(/pinned/);
});
it("does not attach a dispatcher for IP-literal hosts (nothing to pin)", async () => {
  let seen: unknown = "unset";
  const f = vi.fn(async (_u: string, init: RequestInit & { dispatcher?: unknown }) => { seen = init.dispatcher; return new Response("ok"); }) as unknown as typeof fetch;
  await safeFetch("http://93.184.216.34/", {}, { fetchImpl: f });
  expect(seen).toBeUndefined();
});
```
(`lookupFor` is a small test-visible helper attached to the returned dispatcher object so the pinning logic is asserted without opening sockets.)

- [ ] **Step 3: Implement**

`ssrf.ts`: `assertSafeUrl` returns `{ url, addresses }` where `addresses` is the resolver's list (validated all-public) or `[]` for IP literals.

`safeFetch.ts`:

```ts
import { Agent, fetch as undiciFetch, type Dispatcher } from "undici";
import { isIP } from "node:net";

export function pinnedDispatcher(hostname: string, addresses: string[]): Dispatcher & { lookupFor: (h: string) => Promise<{ address: string; family: number }[]> } {
  const answer = addresses.map((address) => ({ address, family: isIP(address) === 6 ? 6 : 4 }));
  const lookupFor = async (h: string) => {
    if (h.toLowerCase() !== hostname.toLowerCase()) throw new Error(`pinned dispatcher refused lookup for ${h}`);
    return answer;
  };
  const agent = new Agent({
    connect: {
      lookup: (h, _opts, cb) => {
        lookupFor(h).then((list) => cb(null, list as never), (e) => cb(e as Error, [] as never));
      },
    },
  });
  return Object.assign(agent, { lookupFor });
}
```
In `safeFetch`, per hop: `const { url: target, addresses } = await assertSafeUrl(current, opts.resolve);` then `const dispatcher = addresses.length ? pinnedDispatcher(target.hostname, addresses) : undefined;` and call `f(target.href, { ...init, method, body, redirect: "manual", signal, ...(dispatcher ? { dispatcher } : {}) } as RequestInit)`; default `f = opts.fetchImpl ?? (undiciFetch as unknown as typeof fetch)`. Close the agent after the response is consumed is not required for short-lived requests, but call `dispatcher.close()` in a `finally` after the hop completes when you created one (do not close before the body is read: close after `res` is returned only for redirect hops; for the final hop leave it open — undici keeps idle sockets briefly and GC handles it; document this). `readCapped` unchanged. Types: the undici `Response` is structurally compatible for our usage; cast at the boundary if `tsc` complains.

Redirect hops re-resolve and re-pin (each hop gets its own dispatcher).

- [ ] **Step 4: Verify, commit**

```bash
npm test && npx tsc --noEmit && npm run lint && npm run test:db
git add -A && git commit -m "feat(security): pin outbound connections to the validated address (DNS-rebinding hardening)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Enrich worker handler as a pure, tested function

**Files:**
- Create: `src/lib/jobs/enrichHandler.ts`, `tests/unit/jobs/enrichHandler.test.ts`
- Modify: `src/worker/index.ts:90-106`

**Interfaces:**
- Produces: `handleEnrichJob(data: EnrichJobData, deps: JobDeps, run?: typeof runEnrich): Promise<"done" | "skipped">` — swallows `BudgetExhaustedError`, `ProviderNotConfiguredError`, `ProviderDisabledError` (returns `"skipped"`), rethrows anything else.

- [ ] **Step 1: Failing unit test**

```ts
import { describe, it, expect, vi } from "vitest";
import { handleEnrichJob } from "@/lib/jobs/enrichHandler";
import { BudgetExhaustedError } from "@/lib/providers/budget";
import { ProviderDisabledError, ProviderNotConfiguredError } from "@/lib/providers/errors";

const deps = { providers: {} as never, log: () => {} };
const data = { businessId: "b1", ownerId: "o1" };

describe("handleEnrichJob", () => {
  it("returns done on success", async () => {
    expect(await handleEnrichJob(data, deps, async () => ({ added: 1, updated: 0, skipped: null }))).toBe("done");
  });
  it.each([new BudgetExhaustedError("apollo"), new ProviderNotConfiguredError("apollo"), new ProviderDisabledError("apollo")])("swallows %s as skipped", async (err) => {
    expect(await handleEnrichJob(data, deps, async () => { throw err; })).toBe("skipped");
  });
  it("rethrows other errors so pg-boss retries", async () => {
    await expect(handleEnrichJob(data, deps, async () => { throw new Error("network"); })).rejects.toThrow("network");
  });
  it("passes force through", async () => {
    const run = vi.fn(async () => ({ added: 0, updated: 0, skipped: null }));
    await handleEnrichJob({ ...data, force: true }, deps, run);
    expect(run).toHaveBeenCalledWith("b1", "o1", deps, { force: true });
  });
});
```
(`vi.mock("@/lib/db", …)` if importing `runEnrich` pulls Prisma into the unit environment — pass `run` explicitly in tests so the default import is never executed.)

- [ ] **Step 2: Implement + rewire worker**

`enrichHandler.ts` contains the try/catch currently inline in the worker; `worker/index.ts` becomes `await boss.work<EnrichJobData>(QUEUES.enrich, { batchSize: 1 }, async ([job]) => { const r = await handleEnrichJob(job.data, { providers: getProviders(), log: console.log, signal: job.signal }); console.log(`[enrich] ${r} ${job.data.businessId}`); });`.

- [ ] **Step 3: Verify, worker smoke, commit**

```bash
npm test && npx tsc --noEmit && npm run lint
git add -A && git commit -m "refactor(worker): extract enrich job handler with unit-tested retry semantics

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Non-root container and digest-pinned base image

**Files:**
- Modify: `Dockerfile`, `README.md` (Deploy section: one line on the pinned digest and how to bump it)

- [ ] **Step 1: Resolve the digest**

```bash
docker pull node:22.22.3-bookworm-slim
docker image inspect node:22.22.3-bookworm-slim --format '{{index .RepoDigests 0}}'
```
Use the printed `node@sha256:…` in both `FROM` lines as `FROM node:22.22.3-bookworm-slim@sha256:<digest> AS deps` / `AS runner`.

- [ ] **Step 2: Non-root runner**

In the runner stage, after the `COPY --from=build` lines: `RUN chown -R node:node /app` then `USER node`. (`node` uid 1000 exists in the official image.) `next start` writes only under `.next/cache` when image optimisation runs; `prisma migrate deploy` needs no writes. Keep `EXPOSE 3000` and the `CMD`.

- [ ] **Step 3: Verify**

```bash
docker build -t sdr-app .
docker run --rm -d --name sdr-web -p 3200:3000 -e DATABASE_URL=postgresql://postgres:sdr@host.docker.internal:5432/sdr -e APP_SECRET=local-docker-secret-at-least-32-characters-long -e APP_PASSPHRASE=change-me -e PROVIDER_MODE=fake -e JOB_MODE=queue sdr-app
sleep 15 && curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3200/api/health   # 200
docker exec sdr-web id -u   # 1000
docker stop sdr-web
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "chore(deploy): run the container as node (non-root); pin the base image digest

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Dependency advisories — CI gate and documentation

**Files:**
- Modify: `.github/workflows/ci.yml`, `README.md`

- [ ] **Step 1: CI gate**

Add to the `test` job after `npm ci`: `- run: npm audit --omit=dev --audit-level=critical`. (Today's advisories are high/moderate, so this passes; it fails the build on any future critical runtime advisory.)

- [ ] **Step 2: README "Known advisories"**

Add a section under Testing:

> `npm audit` reports advisories that are blocked by the version pins in this project:
> - `postcss` (high; XSS/source-map path traversal) — vendored inside `next@15.5`; only exercised at build time by Next's CSS pipeline on our own stylesheets, never on user input. Fix requires Next 16, which is out of scope until the App Router migration is planned.
> - `deepmerge-ts` (moderate) — via `@prisma/config`, used only by the Prisma CLI (migrations), not at runtime.
> CI fails on any **critical** advisory affecting runtime dependencies; re-run `npm audit --omit=dev` when bumping Next or Prisma.

- [ ] **Step 3: Verify locally and commit**

```bash
npm audit --omit=dev --audit-level=critical; echo "exit=$?"   # 0
git add -A && git commit -m "ci: audit gate at critical; docs: known advisories blocked by version pins

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Done criteria for Plan 5

- Unit/DB/e2e suites pass (e2e still 13); CI green including docker and the audit gate.
- Apollo people search sends query-string parameters; businesses without a domain resolve through Organization Search (one extra credit) or return no people after one call; unit tests assert the URLs.
- `safeFetch` connects only to the addresses it validated (pinned dispatcher per hop); unit tests assert the pin.
- Enrich worker retry semantics are unit-tested.
- `docker build` succeeds with the digest-pinned base, the container runs as uid 1000 and serves `/api/health`.
- README documents the known advisories and the digest bump procedure.

## Out of scope

Next 16 / Prisma 7 upgrades; multi-user auth; exercising the Railway deploy end-to-end (needs the user's account and real keys — follow the README).
