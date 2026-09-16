"use client";

import type { LeadRow } from "@/lib/leads/queries";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { categoryLabel } from "@/lib/config/categories";
import { packageLabel } from "@/lib/config/packages";
import { QualityBadge } from "./QualityBadge";
import { SourceBadge } from "./SourceBadge";
import { StatusBadge } from "./StatusBadge";

type Props = {
  rows: LeadRow[];
  selectedIds: Set<string>;
  onToggle: (id: string, checked: boolean) => void;
  onToggleAll: (checked: boolean) => void;
  onOpen: (id: string) => void;
};

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
              <TableHead>Category</TableHead>
              <TableHead>Zip</TableHead>
              <TableHead>Quality</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Package</TableHead>
              <TableHead>Provider</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((b) => (
              <TableRow key={b.id} className="cursor-pointer" onClick={() => onOpen(b.id)} data-testid="lead-row">
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <Checkbox checked={selectedIds.has(b.id)} onCheckedChange={(c) => onToggle(b.id, !!c)} aria-label={`Select ${b.name}`} />
                </TableCell>
                <TableCell className="font-medium">
                  {b.name}
                  {b.exclusion !== "none" && <span className="ml-2 text-xs text-neutral-500">(excluded)</span>}
                </TableCell>
                <TableCell>{categoryLabel(b.primaryCategory)}</TableCell>
                <TableCell>{b.zip}</TableCell>
                <TableCell><QualityBadge band={b.contactQualityBand} score={b.contactQualityScore} /></TableCell>
                <TableCell><SourceBadge source={b.source} /></TableCell>
                <TableCell><StatusBadge status={b.outreachStatus} /></TableCell>
                <TableCell className="text-sm text-neutral-600">{packageLabel(b.suggestedPackage)}</TableCell>
                <TableCell className="text-sm text-neutral-600">{b.currentProviderHint ? `${b.currentProviderHint} (hint)` : ""}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile cards */}
      <ul className="space-y-2 md:hidden" data-testid="leads-cards">
        {rows.map((b) => (
          <li key={b.id} className="rounded-lg border bg-white p-3 dark:bg-neutral-900" onClick={() => onOpen(b.id)}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-medium">{b.name}</div>
                <div className="text-xs text-neutral-500">{categoryLabel(b.primaryCategory)} · {b.zip}</div>
              </div>
              <QualityBadge band={b.contactQualityBand} />
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              <StatusBadge status={b.outreachStatus} />
              <SourceBadge source={b.source} />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
