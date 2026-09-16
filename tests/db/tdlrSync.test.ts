import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { runTdlrSync } from "@/lib/jobs/tdlrSync";
import { readSync, SYNC_KEYS } from "@/lib/jobs/syncStatus";
import { FakeDiscoveryProvider, FakeGeocodeProvider, FakeRegistryProvider, FakeValidationProvider, fakeFetcher, FAKE_PROJECTS } from "@/lib/providers/fake";
import type { ProjectRegistryProvider } from "@/lib/providers/types";

const OWNER = "local-user";
const DAY = 86_400_000;

const providers = {
  geocode: new FakeGeocodeProvider(),
  discovery: new FakeDiscoveryProvider(),
  validation: new FakeValidationProvider(),
  registry: new FakeRegistryProvider(),
  fetcher: fakeFetcher,
};

async function project(number: string) {
  return prisma.project.findUniqueOrThrow({ where: { ownerId_projectNumber: { ownerId: OWNER, projectNumber: number } } });
}

beforeEach(async () => {
  await prisma.activityLog.deleteMany();
  await prisma.project.deleteMany();
  await prisma.syncState.deleteMany();
});

describe("runTdlrSync", () => {
  it("backfills, scores, excludes, and skips long-completed projects", async () => {
    const r = await runTdlrSync({ providers });
    expect(r.scanned).toBe(FAKE_PROJECTS.length);
    expect(r.skippedStale).toBe(1);
    expect(r.created).toBe(3);

    const bella = await prisma.project.findUniqueOrThrow({ where: { ownerId_projectNumber: { ownerId: "local-user", projectNumber: "TABS2027000001" } } });
    expect(bella.facilityName).toBe("Bella Nails & Spa");
    expect(bella.zip).toBe("77084");
    expect(bella.state).toBe("TX");
    expect(bella.workType).toBe("renovation");
    expect(bella.tenantFunded).toBe(true);
    expect(bella.smbFitScore).toBe(95);
    expect(bella.exclusion).toBe("none");
    expect(bella.timingWindow).toBe("opening_soon");
    expect(bella.ownerPhone).toBe("(713) 555-0142");
    expect(bella.statusLabel).toBe("Project Registered");
    expect(bella.detailFetchedAt).not.toBeNull();

    const mh = await prisma.project.findFirstOrThrow({ where: { projectNumber: "TABS2027000003" } });
    expect(mh.exclusion).toBe("enterprise");
    expect(mh.workType).toBe("new_construction");

    expect(await prisma.project.count({ where: { projectNumber: "TABS2027000004" } })).toBe(0);

    const s = await readSync(SYNC_KEYS.tdlr);
    expect(s.lastSuccessfulAt).not.toBeNull();
    expect(s.cursor.status).toBe("idle");
    expect(s.cursor.counts?.created).toBe(3);
  });

  it("is idempotent and only scans registrations since the last success", async () => {
    await runTdlrSync({ providers });
    const second = await runTdlrSync({ providers });
    expect(second.scanned).toBe(0);
    expect(await prisma.project.count()).toBe(3);
  });

  it("refreshes projects last checked more than 30 days ago", async () => {
    await runTdlrSync({ providers });
    const old = new Date(Date.now() - 40 * 86_400_000);
    await prisma.project.updateMany({ data: { lastCheckedAt: old } });
    const r = await runTdlrSync({ providers });
    // Bella + Corner Cafe; Memorial Hermann is excluded (enterprise) and not refreshed. The
    // refresh scope also now excludes closed and already-"stale"-timing projects, but neither
    // Bella (opening_soon) nor Corner Cafe (planned) is closed or stale, so the count here is
    // unchanged from before that scoping was added — see the dedicated refresh-scope test below.
    expect(r.refreshed).toBe(2);
    const bella = await prisma.project.findFirstOrThrow({ where: { projectNumber: "TABS2027000001" } });
    expect(bella.lastCheckedAt!.getTime()).toBeGreaterThan(old.getTime());
  });

  it("excludes already-stale-timing-window projects from the refresh pass, while still refreshing others", async () => {
    await runTdlrSync({ providers });
    const old = new Date(Date.now() - 40 * DAY);
    await prisma.project.updateMany({ data: { lastCheckedAt: old } });
    const cafe = await project("TABS2027000002");
    await prisma.project.update({ where: { id: cafe.id }, data: { timingWindow: "stale", lastCheckedAt: old } });

    const r = await runTdlrSync({ providers });
    expect(r.refreshed).toBe(1); // Bella only; Corner Cafe is skipped for being "stale", Memorial Hermann for exclusion

    const cafeAfter = await project("TABS2027000002");
    expect(cafeAfter.lastCheckedAt!.getTime()).toBe(old.getTime());

    const bellaAfter = await project("TABS2027000001");
    expect(bellaAfter.lastCheckedAt!.getTime()).toBeGreaterThan(old.getTime());
  });

  it("recomputes timingWindow for all projects as time passes, independent of the refresh pass", async () => {
    const now = new Date();
    await runTdlrSync({ providers, now: () => now });

    const bella = await project("TABS2027000001");
    await prisma.project.update({
      where: { id: bella.id },
      data: { completionDate: new Date(now.getTime() + 100 * DAY), timingWindow: "opening_soon" },
    });

    const r = await runTdlrSync({ providers, now: () => now });
    expect(r.retimed).toBeGreaterThanOrEqual(1);

    const bellaAfter = await project("TABS2027000001");
    expect(bellaAfter.timingWindow).toBe("under_construction");
  });

  it("creates projects with parseError set when the detail page is unavailable, and fills them in on a later run", async () => {
    const detaillessRegistry: ProjectRegistryProvider = {
      listProjects: (opts) => providers.registry.listProjects(opts),
      getProjectDetail: async () => null,
    };
    const r1 = await runTdlrSync({ providers: { ...providers, registry: detaillessRegistry } });
    expect(r1.created).toBe(3);

    const bella1 = await project("TABS2027000001");
    expect(bella1.detailFetchedAt).toBeNull();
    expect(bella1.parseError).toBe("detail page unavailable");

    // Clear sync state so the next run rescans the full backfill window: with the normal
    // registeredFrom advanced to the first run's lastSuccessfulAt, a second run would only
    // look at registrations since then and would never revisit these already-registered (but
    // detail-less) projects.
    await prisma.syncState.deleteMany();
    const r2 = await runTdlrSync({ providers });
    expect(r2.updated).toBe(3);

    const bella2 = await project("TABS2027000001");
    expect(bella2.detailFetchedAt).not.toBeNull();
    expect(bella2.parseError).toBeNull();
  });

  it("marks the sync paused when aborted", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await runTdlrSync({ providers, signal: ctrl.signal });
    const s = await readSync(SYNC_KEYS.tdlr);
    expect(s.cursor.status).toBe("paused");
    expect(s.lastSuccessfulAt).toBeNull();
  });

  it("tolerates two concurrent syncs for the same owner racing project.create for the same projectNumber (R4)", async () => {
    const providersB = { geocode: new FakeGeocodeProvider(), discovery: new FakeDiscoveryProvider(), validation: new FakeValidationProvider(), registry: new FakeRegistryProvider(), fetcher: fakeFetcher };
    const [r1, r2] = await Promise.all([runTdlrSync({ providers }), runTdlrSync({ providers: providersB })]);
    // Neither call throws (the P2002-tolerant create means the race loser just skips its own
    // create instead of failing the whole sync), and no projects are duplicated.
    expect(r1.scanned).toBe(FAKE_PROJECTS.length);
    expect(r2.scanned).toBe(FAKE_PROJECTS.length);
    expect(await prisma.project.count()).toBe(3);
  });

  it("fails the sync instead of advancing lastSuccessfulAt when the registry returns a short page", async () => {
    const stub: ProjectRegistryProvider = {
      listProjects: async () => ({ total: 5, items: [] }),
      getProjectDetail: async () => null,
    };
    await expect(runTdlrSync({ providers: { ...providers, registry: stub } })).rejects.toThrow(/empty page/);
    const s = await readSync(SYNC_KEYS.tdlr);
    expect(s.cursor.status).toBe("failed");
    expect(s.lastSuccessfulAt).toBeNull();
  });
});
