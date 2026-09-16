import { CATEGORIES, type Category } from "@/lib/config/categories";
import type { PackageSlug } from "@/lib/config/packages";
import type { SmbWorkType } from "./types";

export function suggestPackage(
  categorySlug: string | null | undefined,
  workType?: SmbWorkType | null,
  categories: Category[] = CATEGORIES,
): PackageSlug | null {
  if (workType === "new_construction") return "full_bundle";
  if (!categorySlug) return null;
  return categories.find((c) => c.slug === categorySlug)?.packageSlug ?? null;
}
