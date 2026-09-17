"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ENRICH_CONFIG } from "@/lib/config/enrichment";
import { formatMonthDayUtc } from "@/lib/format";
import { useLineListBuffer } from "./useLineListBuffer";
import type { EnrichmentConfig } from "./types";

const MAX_PEOPLE_OPTIONS = [1, 2, 3, 4, 5];
// Base UI translation: pass `items` so the trigger shows the matching label immediately, since
// <Select.Value> otherwise resolves labels only from <Select.Item>s that have already mounted
// in the (portalled, closed-by-default) popup.
const MAX_PEOPLE_ITEMS = MAX_PEOPLE_OPTIONS.map((n) => ({ value: String(n), label: `${n} ${n === 1 ? "person" : "people"}` }));

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
  // Same raw-text buffering as ExclusionCard: keep the typed text locally so a space or newline
  // isn't collapsed by re-deriving `join("\n")` on every keystroke, and resync only when the
  // list's *content* changes from outside this component (e.g. a reload after save) -- see
  // useLineListBuffer.
  const [titlesText, setTitlesText] = useLineListBuffer(value.preferredTitles, (preferredTitles) => onChange({ ...value, preferredTitles }));
  const [senioritiesText, setSenioritiesText] = useLineListBuffer(value.seniorities, (seniorities) => onChange({ ...value, seniorities }));

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
          <p className="text-xs text-muted-foreground">Leave blank to use Apollo&apos;s cycle{renewalHint ? ` (renews ${formatMonthDayUtc(renewalHint)})` : ""}</p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="enrichment-metro">Metro area for enrichment</Label>
          <Input
            id="enrichment-metro"
            type="text"
            placeholder="City, State"
            value={value.metroLocation ?? ""}
            onChange={(e) => onChange({ ...value, metroLocation: e.target.value.trim() === "" ? null : e.target.value })}
            data-testid="enrichment-metro"
          />
          <p className="text-xs text-muted-foreground">Used when nobody is found in the lead&apos;s own city: the nearest larger city, written as City, State</p>
        </div>
      </CardContent>
      <CardContent className="space-y-4 border-t pt-4">
        <div className="space-y-1">
          <h3 className="text-sm font-medium">Decision-maker targeting</h3>
          <p className="text-xs text-muted-foreground">
            These three settings work together. The title and seniority filters below decide which people Apollo counts at a
            company, and the chain cutoff is a threshold on that same count &mdash; so if you change either list, the cutoff is
            measuring a different population and should be re-checked against a few known companies before you trust it.
            Searching is free; only revealing a contact costs a credit.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="enrichment-chain-min">Chain cutoff (decision-makers)</Label>
            <Input
              id="enrichment-chain-min"
              type="number"
              min={1}
              max={ENRICH_CONFIG.chainHeadcountMinMax}
              value={value.chainHeadcountMin}
              onChange={(e) => onChange({ ...value, chainHeadcountMin: Number(e.target.value) })}
              data-testid="enrichment-chain-min"
            />
            <p className="text-xs text-muted-foreground">At or above this many matching people company-wide, a lead is treated as a national chain and skipped before any credit is spent</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="enrichment-titles">Titles (one per line)</Label>
            <Textarea
              id="enrichment-titles"
              data-testid="enrichment-titles"
              rows={7}
              value={titlesText}
              onChange={(e) => setTitlesText(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Most-wanted first &mdash; the order also ranks which contact is revealed first. Similar titles are matched too</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="enrichment-seniorities">Seniorities (one per line)</Label>
            <Textarea
              id="enrichment-seniorities"
              data-testid="enrichment-seniorities"
              rows={7}
              value={senioritiesText}
              onChange={(e) => setSenioritiesText(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Apollo&apos;s own seniority codes, lowercase with underscores &mdash; e.g. owner, founder, c_suite, vp, director, manager</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
