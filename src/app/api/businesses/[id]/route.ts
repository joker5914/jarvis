import { z } from "zod";
import { prisma } from "@/lib/db";
import { getActor } from "@/lib/actor";
import { ApiError, handle, json, parseJson } from "@/lib/api";
import { getBusinessDetail } from "@/lib/leads/queries";
import { PRODUCT_SLUGS } from "@/lib/config/packages";
import { loadConfig, saveOverrides } from "@/lib/config/runtime";
import { chainKeyFor } from "@/lib/scoring/smbFit";
import { rescoreExclusions } from "@/lib/jobs/rescore";

export const GET = handle(async (_req, ctx) => {
  const { id } = await ctx.params;
  const actor = await getActor();
  const business = await getBusinessDetail(id, actor.id);
  if (!business) throw new ApiError(404, "Business not found");
  return json({ business });
});

const patchSchema = z
  .object({
    outreachStatus: z.enum(["not_contacted", "contacted", "interested", "not_a_fit", "customer"]).optional(),
    productsPitched: z.array(z.enum(PRODUCT_SLUGS as [string, ...string[]])).optional(),
    notes: z.string().max(20_000).optional(),
    tagIds: z.array(z.string()).optional(),
    /** "Not an SMB (chain)" action (Plan 9 Task 3): only `true` is accepted. */
    markAsChain: z.literal(true).optional(),
    /** "Restore as SMB" un-mark path (fix round): only `true` is accepted, and mutually exclusive
     * with `markAsChain`. Scoped to this one business — see the PATCH handler's `clearChain`
     * branch for why it does not run a table-wide rescoreExclusions the way `markAsChain` does. */
    clearChain: z.literal(true).optional(),
  })
  .refine((b) => !(b.markAsChain && b.clearChain), { message: "markAsChain and clearChain are mutually exclusive" });

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
    // Appends this business's own chain key to the owner's chain list, then re-scores every
    // business so look-alikes (e.g. "Zumiez Outlet" once "Zumiez" is added) are excluded in the
    // same pass — see rescoreExclusions.
    //
    // B1 (fix round review): seeded from `cfg.exclusion.chains` — the *effective* (merged)
    // list — not `cfg.overrides.exclusion?.chains` alone. `mergeConfig` REPLACES `chains`
    // wholesale when an override is present rather than merging element-wise (see runtime.ts), so
    // seeding from the raw override would have persisted just `["<key>"]` on the very first click
    // and silently wiped every one of the ~80 default seed entries for this owner from then on.
    //
    // B2: uses `chainKeyFor`, not `normalizeName` — normalizeName strips "&"/"'"/"-"/".", so
    // "H&R Block" would normalize to "h r block", a string `hasWord` (which scoreSmbFit uses
    // against the raw, punctuation-intact lowercase name) could never match again. chainKeyFor
    // keeps punctuation and only strips a trailing legal-entity suffix. The Set below still dedupes
    // (a second "Not an SMB" click, or a name whose key already matches an existing entry, doesn't
    // add a second copy).
    const cfg = await loadConfig(actor.id);
    const key = chainKeyFor(existing.name);
    // An empty key would match every business (hasWord(text, "") is true); refuse rather than
    // rely on the overrides schema's falsy-entry filter to save us.
    if (!key) throw new ApiError(400, "This business name cannot be used as a chain pattern");
    const chains = new Set(cfg.exclusion.chains);
    chains.add(key);
    const overrides = { ...cfg.overrides, exclusion: { ...cfg.overrides.exclusion, chains: [...chains] } };

    // N6: rescoreExclusions' own newlyExcluded count includes every business whose exclusion
    // flips this pass for ANY reason (e.g. an unrelated same_name_count threshold crossed at the
    // same moment) — not just look-alikes of the chain key just added. Snapshot who was already
    // excluded first, so the response can report only the businesses this specific key newly
    // excluded (what the "N similar leads" toast actually means).
    const before = await prisma.business.findMany({ where: { ownerId: actor.id }, select: { id: true, exclusion: true } });
    const wasExcludedIds = new Set(before.filter((b) => b.exclusion !== "none").map((b) => b.id));

    const nextCfg = await saveOverrides(actor.id, overrides);
    const rescoreResult = await rescoreExclusions(actor.id, nextCfg);

    const reasonTag = `chain:${key}`;
    const keyMatches = await prisma.business.findMany({
      where: { ownerId: actor.id, exclusionReasons: { has: reasonTag } },
      select: { id: true },
    });
    const newlyExcludedByKey = keyMatches.filter((m) => !wasExcludedIds.has(m.id)).length;

    rescore = { scanned: rescoreResult.scanned, newlyExcluded: newlyExcludedByKey, restored: rescoreResult.restored };
  }

  if (body.clearChain) {
    // "Restore as SMB" un-mark path (fix round). Deliberately scoped to this one business rather
    // than a table-wide rescoreExclusions: removing a key from the effective chain list could
    // restore an unknown number of other businesses, which a user un-marking one specific
    // false-positive lead has not reviewed. The global list edit still happens (so future
    // scoring/zip-search passes stop matching this key too), but only this business's own row and
    // reasons change here — hence `rescore: { scanned: 1, ... }`.
    const cfg = await loadConfig(actor.id);
    // Remove the entry that actually excluded this row (recorded as "chain:<entry>" by
    // scoreSmbFit — for a look-alike such as "Zumiez Outlet" that is "zumiez", not its own key)
    // as well as its own key, so the next table-wide rescore cannot re-exclude it.
    const keys = new Set<string>([chainKeyFor(existing.name)]);
    for (const r of existing.exclusionReasons) {
      if (r.startsWith("chain:") && !r.startsWith("chain:apollo_headcount:")) keys.add(r.slice("chain:".length));
    }
    const chains = new Set(cfg.exclusion.chains);
    let removed = false;
    for (const k of keys) removed = chains.delete(k) || removed;
    if (removed) {
      const overrides = { ...cfg.overrides, exclusion: { ...cfg.overrides.exclusion, chains: [...chains] } };
      await saveOverrides(actor.id, overrides);
    }

    // Strips both name-derived ("chain:<key>") and live-Apollo-headcount ("chain:apollo_headcount:<n>")
    // reasons from this business only — any other reason (e.g. a TDLR cost_over_ or entity: match)
    // is left alone and keeps the business excluded.
    const nextReasons = existing.exclusionReasons.filter((r) => !r.startsWith("chain:"));
    const nextExclusion: "none" | "enterprise" = nextReasons.length > 0 ? "enterprise" : "none";
    const wasExcluded = existing.exclusion !== "none";
    await prisma.business.update({ where: { id }, data: { exclusion: nextExclusion, exclusionReasons: nextReasons } });
    await prisma.activityLog.create({ data: { ownerId: actor.id, businessId: id, kind: "status_changed", message: "Restored as SMB" } });

    rescore = { scanned: 1, newlyExcluded: 0, restored: wasExcluded && nextExclusion === "none" ? 1 : 0 };
  }

  const business = await getBusinessDetail(id, actor.id);
  return json({ business, ...(rescore ? { rescore } : {}) });
});
