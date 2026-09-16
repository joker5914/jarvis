"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ProjectsConfig } from "./types";

export function ProjectsCard({ value, onChange }: { value: ProjectsConfig; onChange: (next: ProjectsConfig) => void }) {
  const num = (k: keyof ProjectsConfig) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ ...value, [k]: Number(e.target.value) });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Project scoring</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="projects-high">High fit threshold</Label>
          <Input
            id="projects-high"
            type="number"
            min={0}
            max={100}
            value={value.highFitThreshold}
            onChange={num("highFitThreshold")}
            data-testid="projects-high"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="projects-medium">Medium fit threshold</Label>
          <Input
            id="projects-medium"
            type="number"
            min={0}
            max={100}
            value={value.mediumFitThreshold}
            onChange={num("mediumFitThreshold")}
            data-testid="projects-medium"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="projects-backfill">Backfill months</Label>
          <Input
            id="projects-backfill"
            type="number"
            min={1}
            max={36}
            value={value.backfillMonths}
            onChange={num("backfillMonths")}
            data-testid="projects-backfill"
          />
        </div>
      </CardContent>
    </Card>
  );
}
