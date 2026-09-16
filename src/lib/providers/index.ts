import { defaultFetcher } from "@/lib/extract/website";
import { FakeDiscoveryProvider, FakeGeocodeProvider, FakeValidationProvider, fakeFetcher } from "./fake";
import { GoogleGeocodeProvider, GooglePlacesProvider } from "./google";
import { BuiltinValidationProvider } from "./validation";
import type { Providers } from "./types";

export function getProviders(): Providers {
  const mode = process.env.PROVIDER_MODE ?? "fake";
  if (mode === "fake") {
    return {
      geocode: new FakeGeocodeProvider(),
      discovery: new FakeDiscoveryProvider(),
      validation: new FakeValidationProvider(),
      fetcher: fakeFetcher,
    };
  }
  return {
    geocode: new GoogleGeocodeProvider(),
    discovery: new GooglePlacesProvider(),
    validation: new BuiltinValidationProvider(),
    fetcher: defaultFetcher,
  };
}

export type { Providers } from "./types";
