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
