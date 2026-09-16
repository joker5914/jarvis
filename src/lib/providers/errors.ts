export class ProviderNotConfiguredError extends Error {
  constructor(public provider: string) {
    super(`${provider} API key is not configured`);
    this.name = "ProviderNotConfiguredError";
  }
}
