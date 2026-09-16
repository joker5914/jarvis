import { defaultFetcher } from "@/lib/extract/website";
import { FakeDiscoveryProvider, FakeGeocodeProvider, FakeRegistryProvider, FakeValidationProvider, fakeFetcher } from "./fake";
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
    };
  }
  return {
    geocode: new GoogleGeocodeProvider(),
    discovery: new GooglePlacesProvider(),
    validation: new BuiltinValidationProvider(),
    // TDLR is public records; it is real even when PROVIDER_MODE=real, and fake only in fake mode.
    registry: new TdlrRegistryProvider(),
    fetcher: defaultFetcher,
  };
}

export type { Providers } from "./types";
