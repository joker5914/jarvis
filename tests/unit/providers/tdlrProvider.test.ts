import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { USER_AGENT } from "@/lib/extract/website";
import { TdlrRegistryProvider } from "@/lib/providers/tdlr";

const searchFixture = JSON.parse(
  readFileSync(path.join(import.meta.dirname, "../../fixtures/tdlr-search.json"), "utf8"),
);
const detailHtml = readFileSync(path.join(import.meta.dirname, "../../fixtures/html/tdlr-detail.html"), "utf8");

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TdlrRegistryProvider HTTP contract", () => {
  it("listProjects sends a POST with the expected headers and body, and maps the response", async () => {
    let capturedUrl: string | undefined;
    let capturedInit: RequestInit | undefined;
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return { ok: true, status: 200, json: async () => searchFixture } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new TdlrRegistryProvider();
    const result = await provider.listProjects({
      registeredFrom: new Date(Date.UTC(2026, 8, 1)),
      registeredTo: new Date(Date.UTC(2026, 8, 16)),
      start: 0,
      length: 100,
    });

    expect(capturedUrl).toBe("https://www.tdlr.texas.gov/TABS/Search/SearchProjects");
    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers["content-type"]).toBe("application/x-www-form-urlencoded; charset=UTF-8");
    expect(headers["x-requested-with"]).toBe("XMLHttpRequest");
    expect(headers["user-agent"]).toBe(USER_AGENT);

    const body = new URLSearchParams(capturedInit?.body as string);
    expect(body.get("draw")).toBe("1");
    expect(body.get("start")).toBe("0");
    expect(body.get("length")).toBe("100");
    expect(body.get("order[0][column]")).toBe("3");
    expect(body.get("order[0][dir]")).toBe("asc");
    expect(body.get("columns[3][data]")).toBe("ProjectCreatedOn");
    expect(body.get("LocationCity")).toBe("785");
    expect(body.get("RegistrationDateBegin")).toBe("09/01/2026");
    expect(body.get("RegistrationDateEnd")).toBe("09/16/2026");

    expect(result.total).toBe(searchFixture.recordsFiltered);
    expect(result.items[0].projectNumber).toBe(searchFixture.data[0].ProjectNumber);
  });

  it("listProjects throws on a non-OK response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }) as unknown as Response),
    );

    const provider = new TdlrRegistryProvider();
    await expect(
      provider.listProjects({
        registeredFrom: new Date(Date.UTC(2026, 8, 1)),
        registeredTo: new Date(Date.UTC(2026, 8, 16)),
        start: 0,
        length: 100,
      }),
    ).rejects.toThrow(/TDLR search HTTP 500/);
  });

  it("getProjectDetail GETs the detail page and returns the parsed detail", async () => {
    let capturedUrl: string | undefined;
    let capturedInit: RequestInit | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        capturedUrl = url;
        capturedInit = init;
        return { ok: true, status: 200, text: async () => detailHtml } as unknown as Response;
      }),
    );

    const provider = new TdlrRegistryProvider();
    const detail = await provider.getProjectDetail("TABS2027001089");

    expect(capturedUrl).toBe("https://www.tdlr.texas.gov/TABS/Search/Project/TABS2027001089");
    expect(capturedInit?.method).toBe("GET");
    expect(detail?.projectName).toBe("La Dulce Vida Adult Day Care");
  });

  it("getProjectDetail returns null on a 404", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404 }) as unknown as Response));

    const provider = new TdlrRegistryProvider();
    const detail = await provider.getProjectDetail("TABS0000000000");

    expect(detail).toBeNull();
  });

  it("throttles concurrent requests to at least minIntervalMs apart", async () => {
    const MIN_INTERVAL_MS = 40;
    const timestamps: number[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        timestamps.push(Date.now());
        return { ok: true, status: 200, text: async () => detailHtml } as unknown as Response;
      }),
    );

    const provider = new TdlrRegistryProvider(MIN_INTERVAL_MS);
    await Promise.all([provider.getProjectDetail("TABS2027001089"), provider.getProjectDetail("TABS2027001089")]);

    expect(timestamps).toHaveLength(2);
    // Allow 2ms of slack: Date.now() has integer-ms resolution, so the gate's
    // internal (lastRequestAt + minIntervalMs - Date.now()) math can compute a
    // wait that is up to 1ms short of minIntervalMs due to truncation, and Node's
    // setTimeout may fire up to ~1ms early on a loaded CI runner (observed: 38ms for a
    // 40ms gate). Neither is a throttle bug; the production gate is 1 s (TDLR_MIN_INTERVAL_MS).
    expect(Math.abs(timestamps[1] - timestamps[0])).toBeGreaterThanOrEqual(MIN_INTERVAL_MS - 2);
  });
});
