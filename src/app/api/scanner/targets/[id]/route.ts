import { z } from "zod";
import { prisma } from "@/lib/db";
import { getActor } from "@/lib/actor";
import { ApiError, handle, json, parseJson } from "@/lib/api";
import { logScanner } from "@/lib/scanner/state";

const patchSchema = z.object({ priority: z.number().int().min(0).max(1000).optional(), paused: z.boolean().optional() });

async function owned(id: string, ownerId: string) {
  const t = await prisma.scanTarget.findFirst({ where: { id, ownerId } });
  if (!t) throw new ApiError(404, "Target not found");
  return t;
}

export const PATCH = handle(async (req, ctx) => {
  const { id } = await ctx.params;
  const actor = await getActor();
  await owned(id, actor.id);
  const body = await parseJson(req, patchSchema);
  const target = await prisma.scanTarget.update({ where: { id }, data: body });
  return json({ target });
});

export const DELETE = handle(async (_req, ctx) => {
  const { id } = await ctx.params;
  const actor = await getActor();
  const t = await owned(id, actor.id);
  await prisma.scanTarget.delete({ where: { id } });
  await logScanner(actor.id, `Target ${t.zip} removed`);
  return json({ deleted: true });
});
