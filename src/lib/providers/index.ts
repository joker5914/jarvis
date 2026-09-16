import { defaultFetcher } from "@/lib/extract/website";
import { FakeDiscoveryProvider, FakeEnrichmentProvider, FakeGeocodeProvider, FakeRegistryProvider, FakeValidationProvider, fakeFetcher } from "./fake";
import { ApolloEnrichmentProvider } from "./apollo";
import { GoogleGeocodeProvider, GooglePlacesProvider } from "./google";
import { TdlrRegistryProvider } from "./tdlr";
import { BuiltinValidationProvider } from "./validation";
import type { Providers } from "./types";

export function getProviders(): Providers {
  const mode = process.env.PROVIDER_MODE ?? "fake";
  if (mode === "fake") {
    return {
      geocode: new FakeGeocodeProvider(),
      discovery: new FakeDiscoveryProvider(),
      validation: new FakeValidationProvider(),
      registry: new FakeRegistryProvider(),
      fetcher: fakeFetcher,
      enrichment: new FakeEnrichmentProvider(),
    };
  }
  return {
    geocode: new GoogleGeocodeProvider(),
    discovery: new GooglePlacesProvider(),
    validation: new BuiltinValidationProvider(),
    // TDLR is public records; it is real even when PROVIDER_MODE=real, and fake only in fake mode.
    registry: new TdlrRegistryProvider(),
    fetcher: defaultFetcher,
    enrichment: new ApolloEnrichmentProvider(),
  };
}

export type { Providers } from "./types";
