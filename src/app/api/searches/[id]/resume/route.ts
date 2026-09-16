import { prisma } from "@/lib/db";
import { getActor } from "@/lib/actor";
import { ApiError, handle, json } from "@/lib/api";
import { enqueueZipSearch, MANUAL_PRIORITY, SCANNER_PRIORITY } from "@/lib/jobs/enqueue";

export const POST = handle(async (_req, ctx) => {
  const { id } = await ctx.params;
  const actor = await getActor();
  const search = await prisma.search.findFirst({ where: { id, ownerId: actor.id } });
  if (!search) throw new ApiError(404, "Search not found");
  if (search.status !== "paused") throw new ApiError(409, `Search is ${search.status}, not paused`);
  const origin = search.origin === "scanner" ? "scanner" : "manual";
  if (origin === "scanner") {
    // Re-queueing a scanner-origin search while the Scanner itself is still pause-requested
    // would just have `scannerPauseCheck` re-pause it within seconds of starting — the tick
    // already resumes paused scanner searches on its own once the Scanner is un-paused, so
    // this route defers to that instead of racing it.
    const scannerState = await prisma.scannerState.findUnique({ where: { ownerId: actor.id }, select: { pauseRequested: true } });
    if (scannerState?.pauseRequested) throw new ApiError(409, "Resume the Scanner first");
  }
  const updated = await prisma.search.update({ where: { id }, data: { status: "queued", error: null } });
  await enqueueZipSearch(id, { priority: origin === "scanner" ? SCANNER_PRIORITY : MANUAL_PRIORITY, origin });
  return json({ search: updated }, 202);
});
