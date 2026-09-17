export class ProviderNotConfiguredError extends Error {
  constructor(public provider: string) {
    super(`${provider} API key is not configured`);
    this.name = "ProviderNotConfiguredError";
  }
}

/** Thrown by withBudget when the ProviderConfig row has enabled=false. Unrecoverable by retry:
 * the worker treats this like BudgetExhaustedError/ProviderNotConfiguredError — log and stop,
 * don't let pg-boss retry the job. */
export class ProviderDisabledError extends Error {
  constructor(public provider: string) {
    super(`Provider ${provider} is disabled`);
    this.name = "ProviderDisabledError";
  }
}

/** Thrown by runEnrich when the owner's monthly Apollo credit cap (see src/lib/enrichment/credits.ts)
 * is already reached before any provider call. Unrecoverable by retry — swallowed by
 * handleEnrichJob like the budget/config errors above. */
export class CreditCapReachedError extends Error {
  constructor(
    public used: number,
    public cap: number,
  ) {
    super(`Apollo monthly credit cap reached (${used}/${cap})`);
    this.name = "CreditCapReachedError";
  }
}

/** User-facing explanation for a plan-blocked Apollo call. Apollo returns 403 API_INACCESSIBLE
 * for the People Search / People Enrichment endpoints this app relies on on both the Free plan
 * and the Basic 14-day trial (confirmed against the live key's own API profile — the trial's
 * 403 body says "not included in your Basic (Trial) plan"); only a paid plan gets access. Shared
 * between the thrown error, the enrich routes' 409 body, and the README so the wording never
 * drifts. */
export const APOLLO_PLAN_BLOCK_MESSAGE =
  "Your Apollo plan does not include the people search and enrichment API (free and trial plans are excluded). Upgrade to a paid Apollo plan, then save your API key again in Settings.";

/** Thrown when Apollo returns 403 API_INACCESSIBLE for an endpoint this app relies on (People
 * Search, People Enrichment) — see APOLLO_PLAN_BLOCK_MESSAGE for why. Unrecoverable by retry —
 * swallowed by handleEnrichJob like the errors above, and memoized for a few hours so the app
 * stops calling an endpoint it already knows is blocked. `detail` carries Apollo's raw error
 * code (e.g. "API_INACCESSIBLE") for diagnosis in the activity log; it is never key material. */
export class ProviderPlanError extends Error {
  constructor(
    public provider: string,
    public endpoint: string,
    public detail: string,
  ) {
    super(APOLLO_PLAN_BLOCK_MESSAGE);
    this.name = "ProviderPlanError";
  }
}
