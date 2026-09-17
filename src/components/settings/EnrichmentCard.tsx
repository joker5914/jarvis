"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ENRICH_CONFIG } from "@/lib/config/enrichment";
import type { EnrichmentConfig } from "./types";

const MAX_PEOPLE_OPTIONS = [1, 2, 3, 4, 5];
// Base UI translation: pass `items` so the trigger shows the matching label immediately, since
// <Select.Value> otherwise resolves labels only from <Select.Item>s that have already mounted
// in the (portalled, closed-by-default) popup.
const MAX_PEOPLE_ITEMS = MAX_PEOPLE_OPTIONS.map((n) => ({ value: String(n), label: `${n} ${n === 1 ? "person" : "people"}` }));

/** Formats a `YYYY-MM-DD` local-date string as "Oct 16" without going through the viewer's own
 * timezone (a plain `new Date("2026-10-16")` is midnight UTC, which a US timezone would render as
 * the previous day) — forces UTC on both the parse and the format so the date never shifts. Kept
 * as its own copy rather than importing ProviderKeysCard's (small, presentational, not worth a
 * shared module for one line). */
function formatMonthDay(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function EnrichmentCard({
  value,
  onChange,
  renewalHint,
}: {
  value: EnrichmentConfig;
  onChange: (next: EnrichmentConfig) => void;
  /** Apollo's own cycle-end date (`YYYY-MM-DD`), shown next to the renewal date field when
   * Settings hasn't set one explicitly — see credits.apollo.cycleEnd. */
  renewalHint?: string | null;
}) {
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
            max={ENRICH_CONFIG.monthlyCreditCapMax}
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
          <p className="text-xs text-muted-foreground">Leave blank to use Apollo&apos;s cycle{renewalHint ? ` (renews ${formatMonthDay(renewalHint)})` : ""}</p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="enrichment-metro">Metro area for enrichment</Label>
          <Input
            id="enrichment-metro"
            type="text"
            placeholder="e.g. Houston, Texas"
            value={value.metroLocation ?? ""}
            onChange={(e) => onChange({ ...value, metroLocation: e.target.value || null })}
            data-testid="enrichment-metro"
          />
          <p className="text-xs text-muted-foreground">Used when nobody is found in the lead&apos;s own city, e.g. Houston, Texas</p>
        </div>
      </CardContent>
    </Card>
  );
}
