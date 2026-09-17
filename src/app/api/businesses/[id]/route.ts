import { z } from "zod";
import { prisma } from "@/lib/db";
import { getActor } from "@/lib/actor";
import { ApiError, handle, json, parseJson } from "@/lib/api";
import { getBusinessDetail } from "@/lib/leads/queries";
import { PRODUCT_SLUGS } from "@/lib/config/packages";
import { loadConfig, saveOverrides } from "@/lib/config/runtime";
import { normalizeName } from "@/lib/jobs/shared";
import { rescoreExclusions } from "@/lib/jobs/rescore";

export const GET = handle(async (_req, ctx) => {
  const { id } = await ctx.params;
  const actor = await getActor();
  const business = await getBusinessDetail(id, actor.id);
  if (!business) throw new ApiError(404, "Business not found");
  return json({ business });
});

const patchSchema = z.object({
  outreachStatus: z.enum(["not_contacted", "contacted", "interested", "not_a_fit", "customer"]).optional(),
  productsPitched: z.array(z.enum(PRODUCT_SLUGS as [string, ...string[]])).optional(),
  notes: z.string().max(20_000).optional(),
  tagIds: z.array(z.string()).optional(),
  /** "Not an SMB (chain)" action (Plan 9 Task 3): only `true` is accepted — there is no way to
   * un-mark a business as a chain through this field, since undoing a chain-list addition is a
   * Settings edit (it can affect other businesses too), not a per-business toggle. */
  markAsChain: z.literal(true).optional(),
});

export const PATCH = handle(async (req, ctx) => {
  const { id } = await ctx.params;
  const actor = await getActor();
  const existing = await prisma.business.findFirst({ where: { id, ownerId: actor.id } });
  if (!existing) throw new ApiError(404, "Business not found");
  const body = await parseJson(req, patchSchema);

  // Verify tag ownership before transaction
  let ownedTagIds: string[] = [];
  if (body.tagIds) {
    const ownedTags = await prisma.tag.findMany({ where: { id: { in: body.tagIds }, ownerId: actor.id }, select: { id: true } });
    ownedTagIds = ownedTags.map((t) => t.id);
  }

  await prisma.$transaction(async (tx) => {
    await tx.business.update({
      where: { id },
      data: {
        ...(body.outreachStatus !== undefined && { outreachStatus: body.outreachStatus }),
        ...(body.productsPitched !== undefined && { productsPitched: body.productsPitched }),
        ...(body.notes !== undefined && { notes: body.notes }),
      },
    });
    if (body.tagIds) {
      await tx.businessTag.deleteMany({ where: { businessId: id } });
      await tx.businessTag.createMany({ data: ownedTagIds.map((tagId) => ({ businessId: id, tagId })), skipDuplicates: true });
    }
    if (body.outreachStatus && body.outreachStatus !== existing.outreachStatus) {
      await tx.activityLog.create({
        data: { ownerId: actor.id, businessId: id, kind: "status_changed", message: `Status set to ${body.outreachStatus}` },
      });
    }
  });

  let rescore: { scanned: number; newlyExcluded: number; restored: number } | undefined;
  if (body.markAsChain) {
    // Appends this business's own (normalized) name to the owner's chain list, then re-scores
    // every business so look-alikes (e.g. "Zumiez Outlet" once "Zumiez" is added) are excluded in
    // the same pass — see rescoreExclusions. Dedupe/lowercase happens twice over (normalizeName
    // already lowercases; the Set below also guards a name normalizing to something already in
    // the list), so a second "Not an SMB" click on a sibling business is idempotent.
    const cfg = await loadConfig(actor.id);
    const chains = new Set(cfg.overrides.exclusion?.chains ?? []);
    chains.add(normalizeName(existing.name));
    const overrides = { ...cfg.overrides, exclusion: { ...cfg.overrides.exclusion, chains: [...chains] } };
    const nextCfg = await saveOverrides(actor.id, overrides);
    rescore = await rescoreExclusions(actor.id, nextCfg);
  }

  const business = await getBusinessDetail(id, actor.id);
  return json({ business, ...(rescore ? { rescore } : {}) });
});
