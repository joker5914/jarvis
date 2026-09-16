import { describe, it, expect, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { POST as resumeSearch } from "@/app/api/searches/[id]/resume/route";

const OWNER = "local-user";

beforeEach(async () => {
  await prisma.searchBusiness.deleteMany();
  await prisma.search.deleteMany();
  await prisma.scannerState.deleteMany();
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
  });
});
