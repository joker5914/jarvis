import { CATEGORY_BY_SLUG } from "@/lib/config/categories";
import type { PackageSlug } from "@/lib/config/packages";
import type { SmbWorkType } from "./types";

export function suggestPackage(
  categorySlug: string | null | undefined,
  workType?: SmbWorkType | null,
): PackageSlug | null {
  if (workType === "new_construction") return "full_bundle";
  if (!categorySlug) return null;
  return CATEGORY_BY_SLUG.get(categorySlug)?.packageSlug ?? null;
}
