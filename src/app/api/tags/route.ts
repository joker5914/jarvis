import { z } from "zod";
import { prisma } from "@/lib/db";
import { getActor } from "@/lib/actor";
import { handle, json, parseJson } from "@/lib/api";

export const GET = handle(async () => {
  const actor = await getActor();
  const items = await prisma.tag.findMany({ where: { ownerId: actor.id }, orderBy: [{ isSystem: "asc" }, { name: "asc" }] });
  return json({ items });
});

const schema = z.object({ name: z.string().trim().min(1).max(40), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional() });

export const POST = handle(async (req) => {
  const actor = await getActor();
  const body = await parseJson(req, schema);
  const tag = await prisma.tag.upsert({
    where: { ownerId_name: { ownerId: actor.id, name: body.name } },
    update: { ...(body.color && { color: body.color }) },
    create: { ownerId: actor.id, name: body.name, color: body.color ?? "#64748b" },
  });
  return json({ tag }, 201);
});
