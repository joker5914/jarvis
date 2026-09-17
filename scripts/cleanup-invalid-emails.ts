// scripts/cleanup-invalid-emails.ts — run with: node --env-file=.env --import=tsx scripts/cleanup-invalid-emails.ts [--apply]
//
// One-off cleanup for `Contact` rows of type "email" that predate the extraction boundary fix in
// src/lib/extract/normalize.ts and src/lib/extract/website.ts. A stored value is junk when either:
//   (a) the corrected validator rejects it (bad/implausible TLD, a placeholder address, or a
//       third-party booking/site-builder/support platform domain — see platformDomains.ts), or
//   (b) it's syntactically a valid email but its local part carries a phone/zip fragment glued
//       from adjacent page text (semantically wrong even though normalizeEmail alone can't tell).
//
// Dry run (default) only reports what would be deleted. Pass --apply to actually delete, recompute
// contact quality for affected businesses, and queue a website re-check so the fixed extractor can
// recover the real address.
import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/extract/normalize";
import { isJunkEmail } from "@/lib/extract/junk";

const apply = process.argv.includes("--apply");

async function main() {
  const rows = await prisma.contact.findMany({
    where: { type: "email" },
    select: { id: true, value: true, businessId: true, ownerId: true },
  });

  const bad = rows.filter((r) => normalizeEmail(r.value) !== r.value || isJunkEmail(r.value));

  console.log(`${bad.length} of ${rows.length} email contacts are junk`);
  for (const r of bad.slice(0, 30)) console.log("  ", r.value);

  if (apply && bad.length) {
    await prisma.contact.deleteMany({ where: { id: { in: bad.map((r) => r.id) } } });

    const byOwner = new Map<string, Set<string>>();
    for (const r of bad) {
      if (!byOwner.has(r.ownerId)) byOwner.set(r.ownerId, new Set());
      byOwner.get(r.ownerId)!.add(r.businessId);
    }

    const { recomputeContactQuality } = await import("@/lib/jobs/zipSearch");
    const { enqueueWebsiteRecheck } = await import("@/lib/jobs/enqueue");

    // enqueueWebsiteRecheck's queue policy is "exclusive" (one job queued-or-active per
    // singletonKey); its default key is the fixed "website-recheck" string the scanner tick
    // relies on. Calling it more than once with that default key means every call after the
    // first silently no-ops (boss.send returns null -> false), so each batch here gets its own
    // unique key instead — the tick's call sites are untouched and keep the shared default.
    const runTimestamp = new Date().toISOString();
    for (const [ownerId, ids] of byOwner) {
      for (const id of ids) await recomputeContactQuality(id);
      // Re-scrape with the fixed extractor so the real addresses come back (batches of 25, like the Scanner).
      const list = [...ids];
      const batches = Math.ceil(list.length / 25);
      let queued = 0;
      for (let i = 0, batchIndex = 0; i < list.length; i += 25, batchIndex++) {
        const singletonKey = `website-recheck:cleanup:${runTimestamp}:${ownerId}:${batchIndex}`;
        // origin: "manual" — this is a one-off manual re-check, not the scanner's own work, so
        // it must never pause on a disabled/paused Scanner and must never clear a
        // scanner-owned `website_recheck:<ISO>` marker (see runWebsiteRecheck's doc comment).
        const ok = await enqueueWebsiteRecheck(list.slice(i, i + 25), ownerId, { singletonKey, origin: "manual" });
        if (ok) queued++;
        else console.warn(`  owner ${ownerId}: batch ${batchIndex} (${singletonKey}) was NOT queued (boss.send returned null)`);
      }
      console.log(`owner ${ownerId}: re-scored ${ids.size} businesses, queued ${queued}/${batches} re-check batches`);
    }

    console.log(`deleted ${bad.length}`);
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
