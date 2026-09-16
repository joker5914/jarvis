import { prisma } from "@/lib/db";
import { checkPause, type JobDeps } from "./shared";
import { recomputeContactQuality, scrapeOne, validateEmails } from "./zipSearch";

/** Re-scrape and re-validate a batch of businesses whose website check is stale. */
export async function runWebsiteRecheck(businessIds: string[], ownerId: string, deps: JobDeps): Promise<{ rechecked: number }> {
  let rechecked = 0;
  for (const id of businessIds) {
    await checkPause(deps);
    const b = await prisma.business.findFirst({ where: { id, ownerId }, select: { id: true, websiteUrl: true } });
    if (!b) continue;
    if (b.websiteUrl) {
      try {
        await scrapeOne(id, ownerId, deps);
      } catch (e) {
        await prisma.business.update({ where: { id }, data: { websiteReachable: false, websiteError: (e as Error).message, websiteCheckedAt: new Date() } });
      }
    } else {
      await prisma.business.update({ where: { id }, data: { websiteCheckedAt: new Date() } });
    }
    rechecked++;
  }
  await validateEmails(businessIds, deps);
  for (const id of businessIds) await recomputeContactQuality(id);
  deps.log?.(`website recheck: ${rechecked} businesses`);
  return { rechecked };
}
