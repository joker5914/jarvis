import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { runTdlrSync } from "@/lib/jobs/tdlrSync";
import { readSync, SYNC_KEYS } from "@/lib/jobs/syncStatus";
import { FakeDiscoveryProvider, FakeGeocodeProvider, FakeRegistryProvider, FakeValidationProvider, fakeFetcher, FAKE_PROJECTS } from "@/lib/providers/fake";
import type { ProjectRegistryProvider } from "@/lib/providers/types";

const providers = {
  geocode: new FakeGeocodeProvider(),
  discovery: new FakeDiscoveryProvider(),
  validation: new FakeValidationProvider(),
  registry: new FakeRegistryProvider(),
  fetcher: fakeFetcher,
};

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
    expect(r.refreshed).toBe(2); // Bella + Corner Cafe; Memorial Hermann is excluded and not refreshed
    const bella = await prisma.project.findFirstOrThrow({ where: { projectNumber: "TABS2027000001" } });
    expect(bella.lastCheckedAt!.getTime()).toBeGreaterThan(old.getTime());
  });

  it("marks the sync paused when aborted", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await runTdlrSync({ providers, signal: ctrl.signal });
    const s = await readSync(SYNC_KEYS.tdlr);
    expect(s.cursor.status).toBe("paused");
    expect(s.lastSuccessfulAt).toBeNull();
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
