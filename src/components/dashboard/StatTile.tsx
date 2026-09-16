import { Card, CardContent } from "@/components/ui/card";

export function StatTile({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">{label}</div>
        <div className="mt-1 text-3xl font-semibold tabular-nums">{value}</div>
        {hint && <div className="mt-1 text-xs text-neutral-500">{hint}</div>}
      </CardContent>
    </Card>
  );
}
