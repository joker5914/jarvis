import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";

// The resume route's own logic (paused vs. complete-with-pending vs. neither) is what's under
// test here, not pg-boss connectivity — enqueueZipSearch is mocked so the 202 case never needs
// a live queue, while MANUAL_PRIORITY/SCANNER_PRIORITY stay real so the route's call is checked
// against the actual constants.
const { enqueueZipSearch } = vi.hoisted(() => ({ enqueueZipSearch: vi.fn(async () => true) }));
vi.mock("@/lib/jobs/enqueue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/jobs/enqueue")>();
  return { ...actual, enqueueZipSearch };
});

const resumeRoute = await import("@/app/api/searches/[id]/resume/route");
const resumeSearch = resumeRoute.POST;
const { MANUAL_PRIORITY, SCANNER_PRIORITY } = await import("@/lib/jobs/enqueue");

const OWNER = "local-user";

beforeEach(async () => {
  await prisma.searchBusiness.deleteMany();
  await prisma.search.deleteMany();
  await prisma.scannerState.deleteMany();
  enqueueZipSearch.mockClear();
});

describe("POST /api/searches/[id]/resume", () => {
  it("refuses (409) to resume a scanner-origin search while the Scanner is pause-requested, instead of re-queueing a job that would immediately re-pause", async () => {
    const search = await prisma.search.create({ data: { ownerId: OWNER, zip: "77084", origin: "scanner", status: "paused" } });
    await prisma.scannerState.create({ data: { ownerId: OWNER, pauseRequested: true } });

    const res = await resumeSearch({} as NextRequest, { params: Promise.resolve({ id: search.id }) });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("Resume the Scanner first");
    const stillPaused = await prisma.search.findUniqueOrThrow({ where: { id: search.id } });
    expect(stillPaused.status).toBe("paused");
  });

  it("still 409s a search that is not paused, before touching the Scanner state", async () => {
    const search = await prisma.search.create({ data: { ownerId: OWNER, zip: "77084", origin: "manual", status: "complete" } });

    const res = await resumeSearch({} as NextRequest, { params: Promise.resolve({ id: search.id }) });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("Search is complete, not paused");
    expect(enqueueZipSearch).not.toHaveBeenCalled();
  });

  it("409s a complete search with nothing pending (pendingDiscovery 0), same message as any other non-paused search", async () => {
    const search = await prisma.search.create({ data: { ownerId: OWNER, zip: "77084", origin: "manual", status: "complete", pendingDiscovery: 0 } });

    const res = await resumeSearch({} as NextRequest, { params: Promise.resolve({ id: search.id }) });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("Search is complete, not paused");
    expect(enqueueZipSearch).not.toHaveBeenCalled();
  });

  it("resumes (202) a complete search that has pendingDiscovery > 0, the same as a paused one (\"Find more\")", async () => {
    const search = await prisma.search.create({
      data: { ownerId: OWNER, zip: "77084", origin: "manual", status: "complete", pendingDiscovery: 12, error: null },
    });

    const res = await resumeSearch({} as NextRequest, { params: Promise.resolve({ id: search.id }) });

    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.search.status).toBe("queued");
    const updated = await prisma.search.findUniqueOrThrow({ where: { id: search.id } });
    expect(updated.status).toBe("queued");
    expect(enqueueZipSearch).toHaveBeenCalledTimes(1);
    expect(enqueueZipSearch).toHaveBeenCalledWith(search.id, { priority: MANUAL_PRIORITY, origin: "manual" });
  });

  it("resumes (202) a scanner-origin complete+pending search at scanner priority, when the Scanner isn't pause-requested", async () => {
    const search = await prisma.search.create({
      data: { ownerId: OWNER, zip: "77002", origin: "scanner", status: "complete", pendingDiscovery: 3 },
    });

    const res = await resumeSearch({} as NextRequest, { params: Promise.resolve({ id: search.id }) });

    expect(res.status).toBe(202);
    expect(enqueueZipSearch).toHaveBeenCalledWith(search.id, { priority: SCANNER_PRIORITY, origin: "scanner" });
  });
});
