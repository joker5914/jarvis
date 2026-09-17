"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDate } from "@/lib/format";
import type { CreditStatus, ProviderEntry } from "./types";

function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

/** Formats a `YYYY-MM-DD` local-date string as "Oct 16" without going through the viewer's own
 * timezone (a plain `new Date("2026-10-16")` is midnight UTC, which a US timezone would render
 * as the previous day) — forces UTC on both the parse and the format so the date never shifts. */
function formatMonthDay(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

const STATUS_LABEL: Record<ProviderEntry["source"], string> = {
  env: "From environment",
  stored: "Stored",
  none: "Not configured",
};

function ProviderRow({ p, credits, onChanged }: { p: ProviderEntry; credits?: CreditStatus; onChanged: () => void }) {
  // The key input is intentionally never derived from `p` — a stored key is never echoed back
  // by the API, so there is nothing to pre-fill it with.
  const [key, setKey] = useState("");
  const [budget, setBudget] = useState(String(p.dailyBudget));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setBudget(String(p.dailyBudget));
  }, [p.dailyBudget]);

  async function put(body: Record<string, unknown>, okMsg?: string) {
    setBusy(true);
    try {
      const r = await fetch(`/api/settings/providers/${p.provider}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast.error(data.error ?? "Save failed");
        return;
      }
      if (okMsg) toast.success(okMsg);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function saveKey() {
    if (!key.trim()) return;
    await put({ key: key.trim() }, "Key saved");
    setKey("");
  }

  const clearKey = () => put({ key: null }, "Key cleared");

  function saveBudget() {
    if (budget === String(p.dailyBudget)) return; // unchanged — no-op on a stray blur
    const n = Number(budget);
    if (!Number.isInteger(n) || n < 1 || n > 100_000) {
      toast.error("Budget must be a whole number between 1 and 100000");
      setBudget(String(p.dailyBudget));
      return;
    }
    put({ dailyBudget: n }, "Budget saved");
  }

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{p.label}</span>
        <Badge variant="outline" data-testid={`provider-${p.provider}-status`}>
          {STATUS_LABEL[p.source]}
        </Badge>
        <span className="text-xs text-muted-foreground">
          {p.usedToday} / {p.dailyBudget} used today
        </span>
      </div>
      {p.provider === "apollo" && credits && (
        credits.apollo ? (
          <div className="space-y-0.5" data-testid="credits-used">
            <p className="text-xs text-muted-foreground">
              Apollo account: {formatCount(credits.apollo.leftOver)} of {formatCount(credits.apollo.limit)} credits left · renews{" "}
              {formatMonthDay(credits.apollo.cycleEnd)}
            </p>
            <p className="text-xs text-muted-foreground">
              This app: {credits.used} of {credits.cap} this cycle
            </p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground" data-testid="credits-used">
            Credits used this cycle: {credits.used}/{credits.cap} · cycle started {formatDate(credits.cycleStart)}
          </p>
        )
      )}
      {p.source === "env" && p.hasStoredKey && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          A stored key also exists; the environment variable takes precedence until it is unset.
        </p>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor={`key-${p.provider}`}>API key</Label>
          <Input
            id={`key-${p.provider}`}
            type="password"
            placeholder="Paste API key"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            data-testid={`provider-${p.provider}-key`}
            className="h-8 w-56"
          />
        </div>
        <Button
          size="sm"
          disabled={busy || !key.trim() || p.source === "env"}
          onClick={saveKey}
          data-testid={`provider-${p.provider}-save`}
        >
          Save
        </Button>
        {p.hasStoredKey && (
          <Button size="sm" variant="outline" disabled={busy} onClick={clearKey} data-testid={`provider-${p.provider}-clear`}>
            Clear
          </Button>
        )}
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={p.enabled}
            onCheckedChange={(c) => put({ enabled: !!c })}
            data-testid={`provider-${p.provider}-enabled`}
          />
          Enabled
        </label>
        <div className="space-y-1">
          <Label htmlFor={`budget-${p.provider}`}>Daily budget</Label>
          <Input
            id={`budget-${p.provider}`}
            type="number"
            min={1}
            max={100_000}
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            onBlur={saveBudget}
            data-testid={`provider-${p.provider}-budget`}
            className="h-8 w-28"
          />
        </div>
      </div>
    </div>
  );
}

export function ProviderKeysCard({
  providers,
  credits,
  onChanged,
}: {
  providers: ProviderEntry[];
  credits?: CreditStatus;
  onChanged: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Provider keys</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {providers.map((p) => (
          <ProviderRow key={p.provider} p={p} credits={credits} onChanged={onChanged} />
        ))}
      </CardContent>
    </Card>
  );
}
