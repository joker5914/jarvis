import { REQUEST_TIMEOUT_MS, USER_AGENT } from "@/lib/extract/website";
import { parseTdlrDetail } from "@/lib/extract/tdlrDetail";
import type { SmbWorkType } from "@/lib/scoring/types";
import type { ProjectDetail, ProjectRegistryProvider, ProjectSummary } from "./types";

export const TDLR_BASE = "https://www.tdlr.texas.gov/TABS";
export const TDLR_HOUSTON_CITY_CODE = 785;
export const TDLR_MIN_INTERVAL_MS = 1000;

export const TDLR_STATUS_LABELS: Record<number, string> = {
  3001: "Inspection Completed",
  3002: "Inspection Process",
  3003: "Inspection Scheduled",
  3004: "Preliminary Plan Review",
  3005: "Miscellaneous",
  3006: "Preliminary Review Pending",
  3007: "Project Closed",
  3008: "Project Registered",
  3009: "Review Complete",
  3010: "Review Pending",
};
export const TDLR_STATUS_CLOSED = 3007;

export const TDLR_WORK_TYPES: Record<number, SmbWorkType> = {
  9001: "new_construction",
  9002: "renovation",
  9003: "addition",
  9004: "historic",
  9005: "row",
};

export function workTypeFromCode(code: number | null | undefined): SmbWorkType | null {
  return code == null ? null : (TDLR_WORK_TYPES[code] ?? null);
}

export function workTypeFromLabel(label: string | null | undefined): SmbWorkType | null {
  const l = (label ?? "").toLowerCase();
  if (l.startsWith("new construction")) return "new_construction";
  if (l.startsWith("renovation")) return "renovation";
  if (l.startsWith("addition")) return "addition";
  if (l.startsWith("historic")) return "historic";
  if (l.startsWith("public right")) return "row";
  return null;
}

export function fmtTdlrDate(d: Date): string {
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${mm}/${dd}/${d.getUTCFullYear()}`;
}

export type TdlrSearchRow = {
  ProjectId: string;
  ProjectNumber: string;
  ProjectName: string;
  ProjectCreatedOn: string;
  ProjectStatus: number;
  FacilityName: string | null;
  City: number;
  County: number;
  TypeOfWork: number;
  EstimatedCost: number | null;
  DataVersionId: number;
  EstimatedStartDate: string | null;
  EstimatedEndDate: string | null;
};

/** TDLR timestamps have no zone; treat them as UTC dates. */
function isoToDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s.endsWith("Z") ? s : `${s}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function mapSearchRow(row: TdlrSearchRow): ProjectSummary {
  return {
    tdlrProjectId: row.ProjectId,
    projectNumber: row.ProjectNumber,
    projectName: row.ProjectName ?? "",
    facilityName: row.FacilityName || null,
    registeredAt: isoToDate(row.ProjectCreatedOn) ?? new Date(0),
    statusCode: Number(row.ProjectStatus),
    cityCode: Number(row.City),
    countyCode: Number(row.County),
    workTypeCode: Number(row.TypeOfWork),
    estimatedCost: row.EstimatedCost == null ? null : Number(row.EstimatedCost),
    startDate: isoToDate(row.EstimatedStartDate),
    completionDate: isoToDate(row.EstimatedEndDate),
  };
}

export class TdlrRegistryProvider implements ProjectRegistryProvider {
  private lastRequestAt = 0;

  constructor(private minIntervalMs = TDLR_MIN_INTERVAL_MS) {}

  private async throttle() {
    const wait = this.lastRequestAt + this.minIntervalMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastRequestAt = Date.now();
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    await this.throttle();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(url, { ...init, signal: ctrl.signal, headers: { "user-agent": USER_AGENT, ...(init.headers ?? {}) } });
    } finally {
      clearTimeout(timer);
    }
  }

  async listProjects(opts: { registeredFrom: Date; registeredTo: Date; start: number; length: number }) {
    const body = new URLSearchParams({
      draw: "1",
      start: String(opts.start),
      length: String(opts.length),
      "order[0][column]": "3",
      "order[0][dir]": "asc",
      "columns[3][data]": "ProjectCreatedOn",
      LocationCity: String(TDLR_HOUSTON_CITY_CODE),
      RegistrationDateBegin: fmtTdlrDate(opts.registeredFrom),
      RegistrationDateEnd: fmtTdlrDate(opts.registeredTo),
      DataVersionId: "",
    });
    const res = await this.request(`${TDLR_BASE}/Search/SearchProjects`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        "x-requested-with": "XMLHttpRequest",
      },
      body: body.toString(),
    });
    if (!res.ok) throw new Error(`TDLR search HTTP ${res.status}`);
    const data = (await res.json()) as { recordsFiltered?: number; recordsTotal?: number; data?: TdlrSearchRow[] };
    return { total: Number(data.recordsFiltered ?? data.recordsTotal ?? 0), items: (data.data ?? []).map(mapSearchRow) };
  }

  async getProjectDetail(projectNumber: string): Promise<ProjectDetail | null> {
    const res = await this.request(`${TDLR_BASE}/Search/Project/${encodeURIComponent(projectNumber)}`, { method: "GET" });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`TDLR detail HTTP ${res.status} for ${projectNumber}`);
    const html = await res.text();
    const detail = parseTdlrDetail(html);
    if (!detail.projectNumber && !detail.projectName) return null;
    return detail;
  }
}
