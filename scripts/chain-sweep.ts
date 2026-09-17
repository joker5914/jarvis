// scripts/chain-sweep.ts — run with: node --env-file=.env --import=tsx scripts/chain-sweep.ts [--apply] [--limit N]
//
// Plan 9 Task 3: table-wide version of runEnrich's chain-headcount guard. For every non-excluded
// business with a usable domain (domainFromUrl already filters out shared/social/booking-platform
// hosts — see src/lib/jobs/enrich.ts), runs one Apollo People Search with no location filter
// through the configured provider (so withBudget()'s daily call cap and the plan-block memo both
// apply, exactly like a live Enrich click) and reads totalAtDomain — a free (no-credit),
// title/seniority-filtered decision-maker count (see ENRICH_CONFIG.chainHeadcountMin's doc
// comment; it is NOT a raw employee headcount). The `1` passed as searchPeople's `max` argument is
// only a hint the provider may ignore — ApolloEnrichmentProvider.searchPeople always fetches a
// full ENRICH_CONFIG.searchPageSize page regardless, so this sweep's per-business cost is the same
// whether `max` is 1 or 10.
//
// Dry run (default) only reports; --apply marks a match the same way runEnrich's guard does
// (exclusion: "enterprise", a "chain:apollo_headcount:<n>" reason).
//
// Fix round (review N2): unlike the "Not an SMB" PATCH action, --apply does NOT call
// rescoreExclusions — it marks only the specific businesses this sweep found over the threshold,
// not their name-alikes. Re-run the sweep (or use "Not an SMB" on one of the flagged leads, which
// does re-score) to catch look-alikes too.
//
// The app's own daily Apollo call budget (Settings -> ProviderConfig.dailyBudget/usedToday) bounds
// how many businesses one run can examine; raise it to at least the business count first for full
// coverage. Stops cleanly on BudgetExhaustedError (partial results already printed stay valid)
// instead of crashing the whole sweep.
import { prisma } from "@/lib/db";
import { getActor } from "@/lib/actor";
import { getProviders } from "@/lib/providers";
import { domainFromUrl, redactApiKeyLike } from "@/lib/jobs/enrich";
import { loadConfig } from "@/lib/config/runtime";
import { BudgetExhaustedError } from "@/lib/providers/budget";
import { ProviderNotConfiguredError, ProviderPlanError } from "@/lib/providers/errors";

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
  // Plan 9: threshold and targeting filters are per-owner Settings values, so the sweep has to use
  // the same ones a live Enrich click would -- a sweep run against different filters would be
  // counting a different population than the guard it stands in for.
  const cfg = await loadConfig(actor.id);
  // N4 (fix round review): --limit must apply AFTER skipping shared/social/booking-platform hosts
  // (domainFromUrl returns null for those), not before — otherwise `--limit 50` could examine
  // fewer than 50 actual businesses whenever some of the first N rows have no usable domain.
  const candidates = await prisma.business.findMany({
    where: { ownerId: actor.id, exclusion: "none", websiteUrl: { not: null } },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, websiteUrl: true },
  });
  const withDomain = candidates
    .map((b) => ({ ...b, domain: domainFromUrl(b.websiteUrl) }))
    .filter((b): b is typeof b & { domain: string } => b.domain !== null);
  const businesses = limit ? withDomain.slice(0, limit) : withDomain;

  console.log(
    `Checking ${businesses.length} business(es) with a usable domain${limit ? ` (--limit ${limit})` : ""} for a decision-maker count >= ${cfg.enrichment.chainHeadcountMin}.`,
  );
  console.log(
    "This app's Apollo daily call budget (Settings -> Apollo) bounds how many can be examined in one run — raise it to at least the business count above for full coverage.\n",
  );
  console.log("domain\ttotalAtDomain\tchain?");

  const provider = getProviders().enrichment;
  const toMark: { id: string; name: string; domain: string; total: number }[] = [];
  let checked = 0;
  // L7 (whole-branch review): a missing key or a plan block stops the sweep early too — neither
  // will resolve itself on the next business (a missing key stays missing, and a plan block
  // persists for hours, see apollo.ts), so looping through the rest of the table would just print
  // the same error hundreds of times. One clear line, then stop, same as budget exhaustion.
  let stoppedEarlyReason: "budget" | "not_configured" | "plan_blocked" | null = null;

  for (const b of businesses) {
    try {
      const search = await provider.searchPeople(
        { domain: b.domain, orgName: b.name, city: null, state: null, metro: null, titles: cfg.enrichment.preferredTitles, seniorities: cfg.enrichment.seniorities },
        1,
      );
      checked++;
      const total = search.totalAtDomain;
      const isChain = total !== null && total >= cfg.enrichment.chainHeadcountMin;
      console.log(`${b.domain}\t${total ?? "?"}\t${isChain ? "chain?" : ""}`);
      if (isChain && total !== null) toMark.push({ id: b.id, name: b.name, domain: b.domain, total });
    } catch (e) {
      if (e instanceof BudgetExhaustedError) {
        console.log("\nApollo daily budget exhausted — stopping sweep early (results above are still valid).");
        stoppedEarlyReason = "budget";
        break;
      }
      if (e instanceof ProviderNotConfiguredError) {
        console.log(`\nApollo is not configured (${redactApiKeyLike((e as Error).message).slice(0, 200)}) — stopping sweep early.`);
        stoppedEarlyReason = "not_configured";
        break;
      }
      if (e instanceof ProviderPlanError) {
        console.log(`\nApollo plan does not allow People Search (${redactApiKeyLike((e as Error).message).slice(0, 200)}) — stopping sweep early.`);
        stoppedEarlyReason = "plan_blocked";
        break;
      }
      console.error(`${b.domain}\terror\t${redactApiKeyLike((e as Error).message).slice(0, 200)}`);
    }
  }

  const stoppedEarlyNote =
    stoppedEarlyReason === "budget"
      ? " (stopped early on budget exhaustion)"
      : stoppedEarlyReason === "not_configured"
        ? " (stopped early: Apollo not configured)"
        : stoppedEarlyReason === "plan_blocked"
          ? " (stopped early: Apollo plan blocked)"
          : "";
  console.log(`\n${checked} checked, ${toMark.length} flagged as chains.${stoppedEarlyNote}`);

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
    console.log(`Marked ${m.name} (${m.domain}) as a chain (${m.total} decision-makers at domain).`);
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(redactApiKeyLike(String(err?.message ?? err)));
  await prisma.$disconnect();
  process.exit(1);
});
