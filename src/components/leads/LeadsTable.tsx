"use client";

import type { LeadRow } from "@/lib/leads/queries";
import { leadContactName } from "@/lib/leads/leadContactName";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { categoryLabel } from "@/lib/config/categories";
import { packageLabel } from "@/lib/config/packages";
import { QualityBadge } from "./QualityBadge";
import { SourceBadge } from "./SourceBadge";
import { StatusBadge } from "./StatusBadge";
import { TimingBadge } from "@/components/projects/TimingBadge";

type Props = {
  rows: LeadRow[];
  selectedIds: Set<string>;
  onToggle: (id: string, checked: boolean) => void;
  onToggleAll: (checked: boolean) => void;
  onOpen: (id: string) => void;
};

// leadContactName itself now lives in src/lib/leads/leadContactName.ts (fix round: extracted so
// it's unit-testable without a full LeadRow) — imported above.

export function LeadsTable({ rows, selectedIds, onToggle, onToggleAll, onOpen }: Props) {
  const allSelected = rows.length > 0 && rows.every((r) => selectedIds.has(r.id));
  return (
    <>
      {/* Desktop table */}
      <div className="hidden overflow-x-auto rounded-lg border bg-white md:block dark:bg-neutral-900">
        <Table data-testid="leads-table">
          <TableHeader>
            <TableRow>
              <TableHead className="w-10"><Checkbox checked={allSelected} onCheckedChange={(c) => onToggleAll(!!c)} aria-label="Select all" /></TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Zip</TableHead>
              <TableHead>Quality</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Timing</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Package</TableHead>
              <TableHead>Provider</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((b) => (
              <TableRow
                key={b.id}
                className="cursor-pointer"
                onClick={() => onOpen(b.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onOpen(b.id);
                  }
                }}
                data-testid="lead-row"
              >
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <Checkbox checked={selectedIds.has(b.id)} onCheckedChange={(c) => onToggle(b.id, !!c)} aria-label={`Select ${b.name}`} />
                </TableCell>
                <TableCell className="font-medium">
                  {b.name}
                  {b.exclusion !== "none" && <span className="ml-2 text-xs text-muted-foreground">(excluded)</span>}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{leadContactName(b) ?? "—"}</TableCell>
                <TableCell>{categoryLabel(b.primaryCategory)}</TableCell>
                <TableCell>{b.zip}</TableCell>
                <TableCell><QualityBadge band={b.contactQualityBand} score={b.contactQualityScore} /></TableCell>
                <TableCell><SourceBadge source={b.source} /></TableCell>
                <TableCell><TimingBadge window={b.projects?.[0]?.timingWindow} /></TableCell>
                <TableCell><StatusBadge status={b.outreachStatus} /></TableCell>
                <TableCell className="text-sm text-muted-foreground">{packageLabel(b.suggestedPackage)}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{b.currentProviderHint ? `${b.currentProviderHint} (hint)` : ""}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile cards */}
      <ul className="space-y-2 md:hidden" data-testid="leads-cards">
        {rows.map((b) => (
          <li
            key={b.id}
            className="rounded-lg border bg-white p-3 dark:bg-neutral-900"
            onClick={() => onOpen(b.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onOpen(b.id);
              }
            }}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-medium">
                  {b.name}
                  {b.exclusion !== "none" && <span className="ml-2 text-xs text-muted-foreground">(excluded)</span>}
                </div>
                <div className="text-xs text-muted-foreground">{categoryLabel(b.primaryCategory)} · {b.zip}</div>
                {leadContactName(b) && <div className="text-xs text-muted-foreground">Contact: {leadContactName(b)}</div>}
              </div>
              <QualityBadge band={b.contactQualityBand} />
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              <StatusBadge status={b.outreachStatus} />
              <SourceBadge source={b.source} />
              {b.projects?.[0]?.timingWindow && <TimingBadge window={b.projects[0].timingWindow} />}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
