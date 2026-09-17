// scripts/chain-sweep.ts — run with: node --env-file=.env --import=tsx scripts/chain-sweep.ts [--apply] [--limit N]
//
// Plan 9 Task 3: table-wide version of runEnrich's chain-headcount guard. For every non-excluded
// business with a usable domain (domainFromUrl already filters out shared/social/booking-platform
// hosts — see src/lib/jobs/enrich.ts), runs one Apollo People Search with no location filter and
// per_page 1 through the configured provider (so withBudget()'s daily call cap and the plan-block
// memo both apply, exactly like a live Enrich click) and reads totalAtDomain — a free (no-credit)
// national headcount. Dry run (default) only reports; --apply marks a match the same way
// runEnrich's guard does (exclusion: "enterprise", a "chain:apollo_headcount:<n>" reason) and then
// re-scores so name-alike businesses pick up the same chain entry.
//
// The app's own daily Apollo call budget (Settings -> ProviderConfig.dailyBudget/usedToday) bounds
// how many businesses one run can examine; raise it to at least the business count first for full
// coverage. Stops cleanly on BudgetExhaustedError (partial results already printed stay valid)
// instead of crashing the whole sweep.
import { prisma } from "@/lib/db";
import { getActor } from "@/lib/actor";
import { getProviders } from "@/lib/providers";
import { domainFromUrl } from "@/lib/jobs/enrich";
import { ENRICH_CONFIG } from "@/lib/config/enrichment";
import { BudgetExhaustedError } from "@/lib/providers/budget";

const apply = process.argv.includes("--apply");
const limitIdx = process.argv.indexOf("--limit");
const limit = limitIdx !== -1 ? Number(process.argv[limitIdx + 1]) : undefined;

async function main() {
  if (limitIdx !== -1 && (!Number.isFinite(limit) || (limit as number) <= 0)) {
    console.error(`--limit requires a positive number, got ${process.argv[limitIdx + 1]}`);
    process.exitCode = 1;
    return;
  }

  const actor = await getActor();
  const businesses = await prisma.business.findMany({
    where: { ownerId: actor.id, exclusion: "none", websiteUrl: { not: null } },
    orderBy: { createdAt: "asc" },
    ...(limit ? { take: limit } : {}),
  });

  console.log(
    `Checking up to ${businesses.length} business(es)${limit ? ` (--limit ${limit})` : ""} for a domain-wide headcount >= ${ENRICH_CONFIG.chainHeadcountMin}.`,
  );
  console.log(
    "This app's Apollo daily call budget (Settings -> Apollo) bounds how many can be examined in one run — raise it to at least the business count above for full coverage.\n",
  );
  console.log("domain\ttotalAtDomain\tchain?");

  const provider = getProviders().enrichment;
  const toMark: { id: string; name: string; domain: string; total: number }[] = [];
  let checked = 0;
  let budgetExhausted = false;

  for (const b of businesses) {
    const domain = domainFromUrl(b.websiteUrl);
    if (!domain) continue;
    try {
      const search = await provider.searchPeople({ domain, orgName: b.name, city: null, state: null, metro: null }, 1);
      checked++;
      const total = search.totalAtDomain;
      const isChain = total !== null && total >= ENRICH_CONFIG.chainHeadcountMin;
      console.log(`${domain}\t${total ?? "?"}\t${isChain ? "chain?" : ""}`);
      if (isChain && total !== null) toMark.push({ id: b.id, name: b.name, domain, total });
    } catch (e) {
      if (e instanceof BudgetExhaustedError) {
        console.log("\nApollo daily budget exhausted — stopping sweep early (results above are still valid).");
        budgetExhausted = true;
        break;
      }
      console.error(`${domain}\terror\t${(e as Error).message}`);
    }
  }

  console.log(`\n${checked} checked, ${toMark.length} flagged as chains.${budgetExhausted ? " (stopped early on budget exhaustion)" : ""}`);

  if (!apply) {
    console.log(toMark.length ? "Dry run only — pass --apply to mark these as chains." : "Dry run only.");
    await prisma.$disconnect();
    return;
  }

  if (toMark.length === 0) {
    await prisma.$disconnect();
    return;
  }

  for (const m of toMark) {
    const current = await prisma.business.findUnique({ where: { id: m.id }, select: { exclusionReasons: true } });
    const reason = `chain:apollo_headcount:${m.total}`;
    const nextReasons = [...new Set([...(current?.exclusionReasons ?? []), reason])];
    await prisma.business.update({ where: { id: m.id }, data: { exclusion: "enterprise", exclusionReasons: nextReasons } });
    await prisma.activityLog.create({
      data: { ownerId: actor.id, businessId: m.id, kind: "status_changed", message: `Excluded as chain: ${reason}` },
    });
    console.log(`Marked ${m.name} (${m.domain}) as a chain (${m.total} people at domain).`);
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
