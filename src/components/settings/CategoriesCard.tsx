"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { CategoryEntry, PackageOption } from "./types";

export function CategoriesCard({
  categories,
  packages,
  onChange,
}: {
  categories: CategoryEntry[];
  packages: PackageOption[];
  onChange: (next: CategoryEntry[]) => void;
}) {
  const items = packages.map((p) => ({ value: p.slug, label: p.label }));
  const update = (slug: string, patch: Partial<CategoryEntry>) =>
    onChange(categories.map((c) => (c.slug === slug ? { ...c, ...patch } : c)));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Categories</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {categories.map((c) => (
            <li key={c.slug} className="flex flex-wrap items-center gap-3 py-2 text-sm" data-testid="category-row">
              <Checkbox
                checked={c.enabled}
                onCheckedChange={(v) => update(c.slug, { enabled: !!v })}
                aria-label={`Enable ${c.label}`}
              />
              <span className="min-w-40 font-medium">{c.label}</span>
              <Select
                value={c.packageSlug}
                onValueChange={(v) => {
                  if (v != null) update(c.slug, { packageSlug: v as CategoryEntry["packageSlug"] });
                }}
                items={items}
              >
                <SelectTrigger className="h-8 w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {packages.map((p) => (
                    <SelectItem key={p.slug} value={p.slug}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {c.packageSlug !== c.defaultPackageSlug && (
                <span className="text-xs text-muted-foreground">
                  default: {packages.find((p) => p.slug === c.defaultPackageSlug)?.label ?? c.defaultPackageSlug}
                </span>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
