"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CategoriesCard } from "./CategoriesCard";
import { ExclusionCard } from "./ExclusionCard";
import { ProjectsCard } from "./ProjectsCard";
import { ProviderKeysCard } from "./ProviderKeysCard";
import type { CategoryEntry, ExclusionConfig, ProjectsConfig, SettingsPayload } from "./types";

/** Shallow diff: only the top-level keys of `current` that differ from `defaults`. */
function diffFields<T extends Record<string, unknown>>(current: T, defaults: T): Partial<T> {
  const out: Partial<T> = {};
  for (const k of Object.keys(current) as (keyof T)[]) {
    const a = current[k];
    const b = defaults[k];
    const same =
      Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((v, i) => v === (b as unknown[])[i]) : a === b;
    if (!same) out[k] = a;
  }
  return out;
}

export function SettingsView() {
  const [data, setData] = useState<SettingsPayload | null>(null);
  const [categories, setCategories] = useState<CategoryEntry[]>([]);
  const [exclusion, setExclusion] = useState<ExclusionConfig | null>(null);
  const [projects, setProjects] = useState<ProjectsConfig | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/settings", { cache: "no-store" });
      if (!r.ok) throw new Error();
      const payload: SettingsPayload = await r.json();
      setData(payload);
      setCategories(payload.config.categories);
      setExclusion(payload.config.exclusion);
      setProjects(payload.config.projects);
    } catch {
      toast.error("Could not load settings");
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  function buildOverrides() {
    if (!data || !exclusion || !projects) return null;
    const overrides: { exclusion?: Partial<ExclusionConfig>; projects?: Partial<ProjectsConfig>; categories?: { disabled?: string[]; packageOverrides?: Record<string, string> } } = {};

    const exclusionDiff = diffFields(exclusion, data.defaults.exclusion);
    if (Object.keys(exclusionDiff).length > 0) overrides.exclusion = exclusionDiff;

    const projectsDiff = diffFields(projects, data.defaults.projects);
    if (Object.keys(projectsDiff).length > 0) overrides.projects = projectsDiff;

    const disabled = categories.filter((c) => !c.enabled).map((c) => c.slug);
    const packageOverrides: Record<string, string> = {};
    for (const c of categories) if (c.packageSlug !== c.defaultPackageSlug) packageOverrides[c.slug] = c.packageSlug;
    const categoriesOverride: { disabled?: string[]; packageOverrides?: Record<string, string> } = {};
    if (disabled.length > 0) categoriesOverride.disabled = disabled;
    if (Object.keys(packageOverrides).length > 0) categoriesOverride.packageOverrides = packageOverrides;
    if (Object.keys(categoriesOverride).length > 0) overrides.categories = categoriesOverride;

    return overrides;
  }

  async function putConfig(body: unknown) {
    setSaving(true);
    try {
      const r = await fetch("/api/settings/config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const resBody = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast.error(resBody.error ?? "Save failed");
        return;
      }
      toast.success("Configuration saved");
      load();
    } finally {
      setSaving(false);
    }
  }

  function saveConfig() {
    const overrides = buildOverrides();
    if (overrides) putConfig(overrides);
  }

  function resetConfig() {
    if (!confirm("Reset all configuration to defaults?")) return;
    putConfig({});
  }

  if (!data || !exclusion || !projects) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-4">
      <ProviderKeysCard providers={data.providers} onChanged={load} />
      <CategoriesCard categories={categories} packages={data.packages} onChange={setCategories} />
      <ExclusionCard value={exclusion} onChange={setExclusion} />
      <ProjectsCard value={projects} onChange={setProjects} />
      <div className="flex gap-2">
        <Button disabled={saving} onClick={saveConfig} data-testid="settings-config-save">
          Save configuration
        </Button>
        <Button variant="outline" disabled={saving} onClick={resetConfig}>
          Reset to defaults
        </Button>
      </div>
    </div>
  );
}
