import { prisma } from "@/lib/db";
import { getActor } from "@/lib/actor";
import { handle, json } from "@/lib/api";
import { loadConfig } from "@/lib/config/runtime";
import { budgetStatus } from "@/lib/providers/budget";
import { DEFAULT_EXCLUSION_CONFIG } from "@/lib/config/exclusion";
import { ENRICH_CONFIG } from "@/lib/config/enrichment";
import { creditStatus } from "@/lib/enrichment/credits";
import { PACKAGES } from "@/lib/config/packages";
import { PROJECT_CONFIG } from "@/lib/config/projects";

const PROVIDERS = [
  { provider: "google" as const, label: "Google Places" },
  { provider: "apollo" as const, label: "Apollo.io" },
];

export const GET = handle(async () => {
  const actor = await getActor();
  const cfg = await loadConfig(actor.id);
  const credits = await creditStatus(actor.id, cfg);
  const providers = await Promise.all(
    PROVIDERS.map(async (p) => {
      const row = await prisma.providerConfig.findUnique({ where: { provider: p.provider } });
      const env = process.env[p.provider === "google" ? "GOOGLE_MAPS_API_KEY" : "APOLLO_API_KEY"];
      const status = await budgetStatus(p.provider);
      const source: "env" | "stored" | "none" = env ? "env" : row?.encryptedKey ? "stored" : "none";
      return {
        ...p,
        source,
        hasStoredKey: Boolean(row?.encryptedKey),
        enabled: row?.enabled ?? true,
        dailyBudget: status.limit,
        usedToday: status.used,
      };
    }),
  );
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- entityPatterns are fixed in code, not editable via the API
  const { entityPatterns: _e, ...exclusion } = cfg.exclusion;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- same as above, for the defaults echoed back
  const { entityPatterns: _d, ...defaultExclusion } = DEFAULT_EXCLUSION_CONFIG;
  return json({
    providers,
    config: {
      exclusion,
      categories: cfg.allCategories.map(({ slug, label, enabled, packageSlug, defaultPackageSlug }) => ({
        slug,
        label,
        enabled,
        packageSlug,
        defaultPackageSlug,
      })),
      projects: cfg.projects,
      enrichment: cfg.enrichment,
    },
    credits: { used: credits.used, cap: credits.cap, remaining: credits.remaining, cycleStart: credits.cycleStart, apollo: credits.apollo },
    packages: PACKAGES,
    defaults: {
      exclusion: defaultExclusion,
      projects: {
        highFitThreshold: PROJECT_CONFIG.highFitThreshold,
        mediumFitThreshold: PROJECT_CONFIG.mediumFitThreshold,
        backfillMonths: PROJECT_CONFIG.backfillMonths,
      },
      enrichment: {
        maxPeople: ENRICH_CONFIG.maxPeople,
        monthlyCreditCap: ENRICH_CONFIG.monthlyCreditCapDefault,
        cycleRenewsOn: null,
        metroLocation: null,
        chainHeadcountMin: ENRICH_CONFIG.chainHeadcountMin,
        preferredTitles: [...ENRICH_CONFIG.preferredTitles],
        seniorities: [...ENRICH_CONFIG.seniorities],
      },
    },
  });
});
