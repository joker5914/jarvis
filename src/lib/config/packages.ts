export const PACKAGES = [
  { slug: "internet_tv_voice", label: "Internet + TV + Voice" },
  { slug: "internet_voice_multiline", label: "Internet + Multi-line Voice" },
  { slug: "internet_mobile", label: "Internet + Mobile" },
  { slug: "internet_voice", label: "Internet + Voice" },
  { slug: "full_bundle", label: "Full Bundle (new build)" },
] as const;

export type PackageSlug = (typeof PACKAGES)[number]["slug"];

export const PRODUCTS = [
  { slug: "internet", label: "Internet" },
  { slug: "mobile", label: "Mobile" },
  { slug: "voice", label: "Voice" },
  { slug: "tv", label: "TV" },
  { slug: "security", label: "Security" },
  { slug: "wifi_pro", label: "WiFi Pro" },
  { slug: "other", label: "Other" },
] as const;

export type ProductSlug = (typeof PRODUCTS)[number]["slug"];
export const PRODUCT_SLUGS = PRODUCTS.map((p) => p.slug) as ProductSlug[];

export function packageLabel(slug: string | null | undefined): string {
  return PACKAGES.find((p) => p.slug === slug)?.label ?? "";
}
