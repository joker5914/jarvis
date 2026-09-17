"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { EnrichmentConfig } from "./types";

const MAX_PEOPLE_OPTIONS = [1, 2, 3, 4, 5];
// Base UI translation: pass `items` so the trigger shows the matching label immediately, since
// <Select.Value> otherwise resolves labels only from <Select.Item>s that have already mounted
// in the (portalled, closed-by-default) popup.
const MAX_PEOPLE_ITEMS = MAX_PEOPLE_OPTIONS.map((n) => ({ value: String(n), label: `${n} ${n === 1 ? "person" : "people"}` }));

export function EnrichmentCard({ value, onChange }: { value: EnrichmentConfig; onChange: (next: EnrichmentConfig) => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Apollo enrichment</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="enrichment-max-people">People per business</Label>
          <Select
            value={String(value.maxPeople)}
            onValueChange={(v) => { if (v != null) onChange({ ...value, maxPeople: Number(v) }); }}
            items={MAX_PEOPLE_ITEMS}
          >
            <SelectTrigger id="enrichment-max-people" data-testid="enrichment-max-people"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MAX_PEOPLE_OPTIONS.map((n) => (
                <SelectItem key={n} value={String(n)}>{n} {n === 1 ? "person" : "people"}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="enrichment-cap">Monthly credit cap</Label>
          <Input
            id="enrichment-cap"
            type="number"
            min={0}
            max={1000}
            value={value.monthlyCreditCap}
            onChange={(e) => onChange({ ...value, monthlyCreditCap: Number(e.target.value) })}
            data-testid="enrichment-cap"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="enrichment-renews">Renewal date</Label>
          <Input
            id="enrichment-renews"
            type="date"
            value={value.cycleRenewsOn ?? ""}
            onChange={(e) => onChange({ ...value, cycleRenewsOn: e.target.value || null })}
            data-testid="enrichment-renews"
          />
        </div>
      </CardContent>
    </Card>
  );
}
