import { z } from "zod";
import { prisma } from "@/lib/db";
import { getActor } from "@/lib/actor";
import { handle, json, parseJson } from "@/lib/api";
import { logScanner } from "@/lib/scanner/state";

export const GET = handle(async () => {
  const actor = await getActor();
  const items = await prisma.scanTarget.findMany({ where: { ownerId: actor.id }, orderBy: [{ priority: "desc" }, { zip: "asc" }] });
  return json({ items });
});

const createSchema = z.object({ zip: z.string().regex(/^\d{5}$/), priority: z.number().int().min(0).max(1000).optional() });

export const POST = handle(async (req) => {
  const actor = await getActor();
  const body = await parseJson(req, createSchema);
  const target = await prisma.scanTarget.upsert({
    where: { ownerId_zip: { ownerId: actor.id, zip: body.zip } },
    update: { addedBy: "user", paused: false, ...(body.priority !== undefined && { priority: body.priority }) },
    create: { ownerId: actor.id, zip: body.zip, priority: body.priority ?? 0, addedBy: "user" },
  });
  await logScanner(actor.id, `Target ${body.zip} added`);
  return json({ target }, 201);
});
