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
