import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { getDashboardStats } from "@/lib/leads/stats";

const ownerId = "local-user";

beforeEach(async () => {
  await prisma.activityLog.deleteMany();
  await prisma.business.deleteMany();
});

describe("getDashboardStats", () => {
  it("counts only exclusion:none businesses for totalLeads", async () => {
    await prisma.business.create({ data: { ownerId, name: "A", exclusion: "none" } });
    await prisma.business.create({ data: { ownerId, name: "B", exclusion: "none" } });
    await prisma.business.create({ data: { ownerId, name: "C", exclusion: "enterprise" } });

    const stats = await getDashboardStats(ownerId);
    expect(stats.totalLeads).toBe(2);
  });

  it("counts only contacted status changes, not not_contacted", async () => {
    const business1 = await prisma.business.create({
      data: { ownerId, name: "A", exclusion: "none" },
    });
    const business2 = await prisma.business.create({
      data: { ownerId, name: "B", exclusion: "none" },
    });

    // Create activity logs
    await prisma.activityLog.create({
      data: {
        ownerId,
        businessId: business1.id,
        kind: "status_changed",
        message: "Status set to contacted",
      },
    });
    await prisma.activityLog.create({
      data: {
        ownerId,
        businessId: business2.id,
        kind: "status_changed",
        message: "Status set to not_contacted",
      },
    });

    const stats = await getDashboardStats(ownerId);
    expect(stats.contactedThisWeek).toBe(1);
  });
});
