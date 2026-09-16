"use client";

import Link from "next/link";
import type { ProjectRow } from "@/lib/projects/queries";
import type { SmbFitThresholds } from "@/lib/scoring/smbFit";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { formatDate, titleCase } from "@/lib/format";
import { TimingBadge } from "./TimingBadge";
import { FitBadge } from "./FitBadge";

const money = (n: number | null) => (n == null ? "" : `$${Math.round(n).toLocaleString()}`);

type Props = { rows: ProjectRow[]; onOpen: (id: string) => void; onFind: (id: string) => void; thresholds?: SmbFitThresholds };

function rowKeys(onOpen: () => void) {
  return {
    role: "button" as const,
    tabIndex: 0,
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } },
  };
}

export function ProjectsTable({ rows, onOpen, onFind, thresholds }: Props) {
  return (
    <>
      <div className="hidden overflow-x-auto rounded-lg border bg-white md:block dark:bg-neutral-900">
        <Table data-testid="projects-table">
          <TableHeader>
            <TableRow>
              <TableHead>Project</TableHead>
              <TableHead>Zip</TableHead>
              <TableHead>Work</TableHead>
              <TableHead>Cost</TableHead>
              <TableHead>Completes</TableHead>
              <TableHead>Timing</TableHead>
              <TableHead>SMB fit</TableHead>
              <TableHead>Lead</TableHead>
              <TableHead className="w-32"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((p) => (
              <TableRow key={p.id} className="cursor-pointer" onClick={() => onOpen(p.id)} {...rowKeys(() => onOpen(p.id))} data-testid="project-row">
                <TableCell>
                  <div className="font-medium">{p.facilityName || p.projectName}</div>
                  {p.facilityName && p.facilityName !== p.projectName && <div className="text-xs text-muted-foreground">{p.projectName}</div>}
                </TableCell>
                <TableCell>{p.zip}</TableCell>
                <TableCell className="text-sm">{titleCase(p.workType)}</TableCell>
                <TableCell className="text-sm tabular-nums">{money(p.estimatedCost)}</TableCell>
                <TableCell className="text-sm">{formatDate(p.completionDate)}</TableCell>
                <TableCell><TimingBadge window={p.timingWindow} /></TableCell>
                <TableCell><FitBadge score={p.smbFitScore} excluded={p.exclusion !== "none"} thresholds={thresholds} /></TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  {p.business ? (
                    <Link href={`/leads/${p.business.id}`} className="text-sm text-blue-600 hover:underline">{p.business.name}</Link>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  {!p.business && p.exclusion === "none" && (
                    <Button size="sm" variant="outline" onClick={() => onFind(p.id)} data-testid="find-business">Find business</Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ul className="space-y-2 md:hidden" data-testid="projects-cards">
        {rows.map((p) => (
          <li key={p.id} className="rounded-lg border bg-white p-3 dark:bg-neutral-900" onClick={() => onOpen(p.id)} {...rowKeys(() => onOpen(p.id))}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-medium">{p.facilityName || p.projectName}</div>
                <div className="text-xs text-muted-foreground">{p.zip} · {titleCase(p.workType)} · {money(p.estimatedCost)}</div>
              </div>
              <FitBadge score={p.smbFitScore} excluded={p.exclusion !== "none"} thresholds={thresholds} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <TimingBadge window={p.timingWindow} />
              <span className="text-xs text-muted-foreground">completes {formatDate(p.completionDate)}</span>
              {p.business && <Link href={`/leads/${p.business.id}`} onClick={(e) => e.stopPropagation()} className="text-xs text-blue-600">Lead: {p.business.name}</Link>}
              {!p.business && p.exclusion === "none" && (
                <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); onFind(p.id); }} data-testid="find-business">Find business</Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
