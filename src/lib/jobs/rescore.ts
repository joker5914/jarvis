import { prisma } from "@/lib/db";
import { normalizeName } from "./shared";
import { scoreSmbFit } from "@/lib/scoring/smbFit";
import { loadConfig, type RuntimeConfig } from "@/lib/config/runtime";

/**
 * Re-applies scoreSmbFit to every business the owner has, after the exclusion chain list changes
 * (Plan 9 Task 3: "Not an SMB" action / a Settings edit / chain-sweep --apply). Uses the same
 * same-name (chain) `nameCounts` logic as zipSearch.ts's upsertBusinesses (~line 176) so a
 * look-alike name that only becomes "too common" once this owner has several businesses with the
 * same name is caught the same way discovery-time scoring would catch it.
 *
 * A business whose current `exclusionReasons` include an `apollo_headcount:`-prefixed reason (set
 * by runEnrich's chain-headcount guard — see ENRICH_CONFIG.chainHeadcountMin) stays excluded for
 * that reason regardless of what scoreSmbFit says about its name: that reason is a live Apollo
 * signal, not name-derived, so a name-based re-score must never silently un-exclude it. Reasons
 * are merged (name-derived ones from this pass + any preserved apollo_headcount ones), never
 * overwritten wholesale.
 *
 * Writes `exclusion`/`exclusionReasons` only when they actually change, and logs one
 * `status_changed`-kind activity row per business whose exclusion state flips either way
 * ("Excluded as chain: <reason>" / "Exclusion lifted") — `status_changed` is the existing kind
 * ActivityLog uses for a business's status flipping (see the outreachStatus PATCH routes); there
 * is no dedicated exclusion-change kind and `kind` is a plain string column, not an enum, so this
 * reuses rather than invents one.
 */
export async function rescoreExclusions(
  ownerId: string,
  cfg?: RuntimeConfig,
): Promise<{ scanned: number; newlyExcluded: number; restored: number }> {
  const config = cfg ?? (await loadConfig(ownerId));
  const businesses = await prisma.business.findMany({ where: { ownerId } });

  const nameCounts = new Map<string, number>();
  for (const b of businesses) {
    const n = normalizeName(b.name);
    nameCounts.set(n, (nameCounts.get(n) ?? 0) + 1);
  }

  let newlyExcluded = 0;
  let restored = 0;

  for (const b of businesses) {
    const fit = scoreSmbFit(
      { name: b.name, sameNameCount: nameCounts.get(normalizeName(b.name)) },
      config.exclusion,
      config.projects,
    );
    // Not name-derived — a live Apollo headcount signal from runEnrich/chain-sweep. Preserved
    // across a name-based re-score no matter what scoreSmbFit concludes about the name today.
    const keptHeadcountReasons = b.exclusionReasons.filter((r) => r.startsWith("chain:apollo_headcount:"));
    const nextExcluded = fit.excluded || keptHeadcountReasons.length > 0;
    const nextReasons = nextExcluded
      ? [...new Set([...(fit.excluded ? fit.exclusionReasons : []), ...keptHeadcountReasons])]
      : [];
    const nextExclusion: "none" | "enterprise" = nextExcluded ? "enterprise" : "none";
    const wasExcluded = b.exclusion !== "none";
    const reasonsChanged =
      nextReasons.length !== b.exclusionReasons.length || [...nextReasons].sort().join("") !== [...b.exclusionReasons].sort().join("");

    if (nextExclusion === b.exclusion && !reasonsChanged) continue;

    await prisma.business.update({ where: { id: b.id }, data: { exclusion: nextExclusion, exclusionReasons: nextReasons } });

    if (!wasExcluded && nextExcluded) {
      newlyExcluded++;
      const reason = nextReasons.find((r) => r.startsWith("chain:")) ?? nextReasons[0] ?? "unknown";
      await prisma.activityLog.create({
        data: { ownerId, businessId: b.id, kind: "status_changed", message: `Excluded as chain: ${reason}` },
      });
    } else if (wasExcluded && !nextExcluded) {
      restored++;
      await prisma.activityLog.create({
        data: { ownerId, businessId: b.id, kind: "status_changed", message: "Exclusion lifted" },
      });
    }
  }

  return { scanned: businesses.length, newlyExcluded, restored };
}
