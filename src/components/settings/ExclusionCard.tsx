"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useLineListBuffer } from "./useLineListBuffer";
import type { ExclusionConfig } from "./types";

export function ExclusionCard({ value, onChange }: { value: ExclusionConfig; onChange: (next: ExclusionConfig) => void }) {
  // The textareas keep their own raw text so a space or newline the user just typed isn't
  // immediately collapsed by re-deriving `value.chains.join("\n")` (which drops trailing blank
  // lines) on every keystroke. They only resync from `value` when the list's *content* changes
  // from outside this component (e.g. a reload after save) -- see useLineListBuffer.
  const [chainsText, setChainsText] = useLineListBuffer(value.chains, (chains) => onChange({ ...value, chains }));
  const [positiveText, setPositiveText] = useLineListBuffer(value.positiveKeywords, (positiveKeywords) => onChange({ ...value, positiveKeywords }));
  const [softText, setSoftText] = useLineListBuffer(value.softNegativeKeywords, (softNegativeKeywords) => onChange({ ...value, softNegativeKeywords }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Exclusions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <Label htmlFor="exclusion-chains">Chains (one per line)</Label>
          <Textarea
            id="exclusion-chains"
            data-testid="exclusion-chains"
            rows={4}
            value={chainsText}
            onChange={(e) => setChainsText(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="exclusion-positive">Positive keywords (one per line)</Label>
          <Textarea
            id="exclusion-positive"
            data-testid="exclusion-positive"
            rows={4}
            value={positiveText}
            onChange={(e) => setPositiveText(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="exclusion-soft">Soft-negative keywords (one per line)</Label>
          <Textarea
            id="exclusion-soft"
            data-testid="exclusion-soft"
            rows={4}
            value={softText}
            onChange={(e) => setSoftText(e.target.value)}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="cost-hard-limit">Cost hard limit ($)</Label>
            <Input
              id="cost-hard-limit"
              type="number"
              min={0}
              value={value.costHardLimit}
              onChange={(e) => onChange({ ...value, costHardLimit: Number(e.target.value) })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="same-name-limit">Same-name limit</Label>
            <Input
              id="same-name-limit"
              type="number"
              min={1}
              max={100}
              value={value.sameNameLimit}
              onChange={(e) => onChange({ ...value, sameNameLimit: Number(e.target.value) })}
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Government/education/health-system patterns are fixed in code.</p>
      </CardContent>
    </Card>
  );
}
