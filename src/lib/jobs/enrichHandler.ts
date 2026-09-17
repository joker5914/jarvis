import { runEnrich } from "./enrich";
import type { JobDeps } from "./shared";
import type { EnrichJobData } from "./queues";
import { BudgetExhaustedError } from "@/lib/providers/budget";
import { ProviderNotConfiguredError, ProviderDisabledError } from "@/lib/providers/errors";

/**
 * Runs one enrich job. `run` defaults to `runEnrich`; tests inject a fake to avoid pulling
 * Prisma into the call path.
 *
 * BudgetExhaustedError/ProviderNotConfiguredError/ProviderDisabledError are unrecoverable by
 * retrying — runEnrich already recorded exactly one activity row explaining why — so those
 * are swallowed and reported as "skipped" rather than rethrown, keeping pg-boss from retrying
 * into a duplicate activity row. Any other error propagates to pg-boss's retry policy.
 */
export async function handleEnrichJob(data: EnrichJobData, deps: JobDeps, run: typeof runEnrich = runEnrich): Promise<"done" | "skipped"> {
  const { businessId, ownerId, force } = data;
  try {
    await run(businessId, ownerId, deps, { force });
    return "done";
  } catch (e) {
    if (e instanceof BudgetExhaustedError || e instanceof ProviderNotConfiguredError || e instanceof ProviderDisabledError) {
      return "skipped";
    }
    throw e;
  }
}
