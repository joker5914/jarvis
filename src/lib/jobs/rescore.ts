import { prisma } from "@/lib/db";
import { normalizeName } from "./shared";
import { scoreSmbFit } from "@/lib/scoring/smbFit";
import { loadConfig, type RuntimeConfig } from "@/lib/config/runtime";

// scoreSmbFit reasons this pass CAN regenerate from scratch (it only ever passes { name,
// sameNameCount } — no estimatedCost/workType, so cost_over_/public_right_of_way can never come
// from `fit` here). "chain:apollo_headcount:" also starts with "chain:" but is deliberately
// excluded from this set below — it's a live Apollo signal, not something scoreSmbFit produces or
// can invalidate.
function isRegeneratedByThisPass(reason: string): boolean {
  if (reason.startsWith("chain:apollo_headcount:")) return false;
  return reason.startsWith("chain:") || reason.startsWith("entity:") || reason.startsWith("same_name_count:");
}

/**
 * Re-applies scoreSmbFit to every business the owner has, called by the "Not an SMB" PATCH action
 * (Plan 9 Task 3) right after it edits the chain list, so look-alike businesses pick up the same
 * exclusion in the same request. Uses the same same-name (chain) `nameCounts` logic as
 * zipSearch.ts's upsertBusinesses (~line 176) so a look-alike name that only becomes "too common"
 * once this owner has several businesses with the same name is caught the same way discovery-time
 * scoring would catch it.
 *
 * Nothing else calls this today (fix round, review N2): a plain Settings edit to the chain list
 * (ExclusionCard/PUT /api/settings) does NOT re-score existing businesses — it only changes what
 * the *next* zip-search scoring pass or "Not an SMB" click will do — and `scripts/chain-sweep.ts
 * --apply` marks only the specific business it found over the headcount threshold, without calling
 * this to catch its look-alikes too. Both are known gaps, not bugs this function is responsible
 * for closing.
 *
 * A reason this pass has no way to regenerate (see `isRegeneratedByThisPass` above — a TDLR
 * cost/right-of-way reason, or a `chain:apollo_headcount:*` live Apollo signal) is always carried
 * over unchanged, no matter what scoreSmbFit concludes about the name today: only the reasons this
 * pass IS able to recompute (`chain:`, `entity:`, `same_name_count:`) are replaced by its fresh
 * output. A business stays excluded as long as at least one reason (recomputed or carried over)
 * remains.
 *
 * Writes `exclusion`/`exclusionReasons` only when they actually change, and logs one
 * `status_changed`-kind activity row per business whose exclusion state flips either way
 * ("Excluded: <reason>" / "Exclusion lifted" — reason-agnostic since this pass can flip a
 * business for an entity/same_name reason too, not just a chain match) — `status_changed` is the existing kind
 * ActivityLog uses for a business's status flipping (see the outreachStatus PATCH routes); there
 * is no dedicated exclusion-change kind and `kind` is a plain string column, not an enum, so this
 * reuses rather than invents one. All writes for one run land in a single transaction.
 */
export async function rescoreExclusions(
  ownerId: string,
  cfg?: RuntimeConfig,
): Promise<{ scanned: number; newlyExcluded: number; restored: number }> {
  const config = cfg ?? (await loadConfig(ownerId));
  const businesses = await prisma.business.findMany({
    where: { ownerId },
    select: { id: true, name: true, exclusion: true, exclusionReasons: true },
  });

  const nameCounts = new Map<string, number>();
  for (const b of businesses) {
    const n = normalizeName(b.name);
    nameCounts.set(n, (nameCounts.get(n) ?? 0) + 1);
  }

  let newlyExcluded = 0;
  let restored = 0;
  const updates: ReturnType<typeof prisma.business.update>[] = [];
  const activityRows: { ownerId: string; businessId: string; kind: string; message: string }[] = [];

  for (const b of businesses) {
    const fit = scoreSmbFit(
      { name: b.name, sameNameCount: nameCounts.get(normalizeName(b.name)) },
      config.exclusion,
      config.projects,
    );
    // Everything this pass has no information to recompute — carried over unchanged.
    const preserved = b.exclusionReasons.filter((r) => !isRegeneratedByThisPass(r));
    const nextExcluded = fit.excluded || preserved.length > 0;
    const nextReasons = [...new Set([...fit.exclusionReasons, ...preserved])];
    const nextExclusion: "none" | "enterprise" = nextExcluded ? "enterprise" : "none";
    const wasExcluded = b.exclusion !== "none";
    const reasonsChanged = [...nextReasons].sort().join("|") !== [...b.exclusionReasons].sort().join("|");

    if (nextExclusion === b.exclusion && !reasonsChanged) continue;

    updates.push(prisma.business.update({ where: { id: b.id }, data: { exclusion: nextExclusion, exclusionReasons: nextReasons } }));

    if (!wasExcluded && nextExcluded) {
      newlyExcluded++;
      // L4 (whole-branch review): this pass can flip a business for an entity/same_name reason
      // too, not just a chain match — "Excluded as chain: <reason>" read wrong for those, so the
      // message is now reason-agnostic and lets the reason string itself say what kind it is.
      const reason = nextReasons.find((r) => r.startsWith("chain:")) ?? nextReasons[0] ?? "unknown";
      activityRows.push({ ownerId, businessId: b.id, kind: "status_changed", message: `Excluded: ${reason}` });
    } else if (wasExcluded && !nextExcluded) {
      restored++;
      activityRows.push({ ownerId, businessId: b.id, kind: "status_changed", message: "Exclusion lifted" });
    }
  }

  if (updates.length > 0) {
    await prisma.$transaction([...updates, ...(activityRows.length > 0 ? [prisma.activityLog.createMany({ data: activityRows })] : [])]);
  }

  return { scanned: businesses.length, newlyExcluded, restored };
}
