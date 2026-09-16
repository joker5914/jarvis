"use client";

import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ExclusionConfig } from "./types";

const linesToArray = (v: string) => v.split("\n").map((s) => s.trim()).filter(Boolean);

export function ExclusionCard({ value, onChange }: { value: ExclusionConfig; onChange: (next: ExclusionConfig) => void }) {
  // The textareas keep their own raw text so a newline the user just typed isn't immediately
  // collapsed by re-deriving `value.chains.join("\n")` (which drops trailing blank lines) on
  // every keystroke. They only resync from `value` when it changes identity from outside this
  // component (e.g. a reload after save), not on every local edit.
  const [chainsText, setChainsText] = useState(value.chains.join("\n"));
  const [positiveText, setPositiveText] = useState(value.positiveKeywords.join("\n"));
  const [softText, setSoftText] = useState(value.softNegativeKeywords.join("\n"));
  const lastValue = useRef(value);
  useEffect(() => {
    if (lastValue.current !== value) {
      lastValue.current = value;
      setChainsText(value.chains.join("\n"));
      setPositiveText(value.positiveKeywords.join("\n"));
      setSoftText(value.softNegativeKeywords.join("\n"));
    }
  }, [value]);

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
            onChange={(e) => {
              setChainsText(e.target.value);
              onChange({ ...value, chains: linesToArray(e.target.value) });
            }}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="exclusion-positive">Positive keywords (one per line)</Label>
          <Textarea
            id="exclusion-positive"
            data-testid="exclusion-positive"
            rows={4}
            value={positiveText}
            onChange={(e) => {
              setPositiveText(e.target.value);
              onChange({ ...value, positiveKeywords: linesToArray(e.target.value) });
            }}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="exclusion-soft">Soft-negative keywords (one per line)</Label>
          <Textarea
            id="exclusion-soft"
            data-testid="exclusion-soft"
            rows={4}
            value={softText}
            onChange={(e) => {
              setSoftText(e.target.value);
              onChange({ ...value, softNegativeKeywords: linesToArray(e.target.value) });
            }}
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
        <p className="text-xs text-neutral-500">Government/education/health-system patterns are fixed in code.</p>
      </CardContent>
    </Card>
  );
}
