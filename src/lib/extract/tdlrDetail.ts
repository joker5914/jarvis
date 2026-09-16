import * as cheerio from "cheerio";
import type { ProjectDetail } from "@/lib/providers/types";

export function parseTdlrDate(s: string | null | undefined): Date | null {
  const m = (s ?? "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2])));
}

export function parseMoney(s: string | null | undefined): number | null {
  const cleaned = (s ?? "").replace(/[^0-9.]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function parseSqft(s: string | null | undefined): number | null {
  const m = (s ?? "").match(/([\d,]+)/);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

const STATE_NAMES: Record<string, string> = { texas: "TX" };

export function parseAddressLines(lines: string[]): {
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
} {
  const clean = lines.map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  if (clean.length === 0) return { address: null, city: null, state: null, zip: null };
  const last = clean[clean.length - 1];
  const m = last.match(/^(.*?),\s*([A-Za-z .]+?)\s+(\d{5})(?:-\d{4})?$/);
  if (!m) return { address: clean.join(", "), city: null, state: null, zip: null };
  const rawState = m[2].trim();
  const state = rawState.length === 2 ? rawState.toUpperCase() : (STATE_NAMES[rawState.toLowerCase()] ?? rawState);
  return {
    address: clean.slice(0, -1).join(", ") || null,
    city: m[1].trim(),
    state,
    zip: m[3],
  };
}

type Fields = Map<string, string[]>;

/** Reads every <dl> under `root` into { "Label": ["dd text", ...] } (label without trailing colon). */
function readFields($: cheerio.CheerioAPI, root: ReturnType<cheerio.CheerioAPI>): Fields {
  const out: Fields = new Map();
  root.find("dl").each((_, dl) => {
    let key: string | null = null;
    $(dl)
      .children()
      .each((_, el) => {
        const text = $(el).text().replace(/\s+/g, " ").trim();
        if (el.tagName === "dt") {
          key = text.replace(/:$/, "").trim();
          if (!out.has(key)) out.set(key, []);
        } else if (el.tagName === "dd" && key) {
          out.get(key)!.push(text);
        }
      });
  });
  return out;
}

const first = (f: Fields, key: string): string | null => {
  const v = f.get(key)?.[0]?.trim();
  return v ? v : null;
};

function sectionName($: cheerio.CheerioAPI, selector: string, key: string): string | null {
  const sec = $(selector);
  if (sec.length === 0) return null;
  if (/not assigned/i.test(sec.find("p").first().text())) return null;
  const f = readFields($, sec);
  return first(f, key) ?? f.values().next().value?.[0] ?? null;
}

export function parseTdlrDetail(html: string): ProjectDetail {
  const $ = cheerio.load(html);
  const project = readFields($, $(".project-details-project"));
  const contact = readFields($, $(".project-details-contact"));
  const ras = readFields($, $(".project-details-ras"));
  const owner = readFields($, $(".project-details-owner"));

  const loc = parseAddressLines(project.get("Location Address") ?? []);
  const ownerAddr = (owner.get("Owner Address") ?? []).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const headerText = $(".project-details-header").text().replace(/\s+/g, " ");
  const regMatch = headerText.match(/Registration Date:\s*(\d{1,2}\/\d{1,2}\/\d{4})/);
  const tenant = first(project, "Are the private funds provided by the tenant?");

  return {
    projectNumber: first(project, "Project Number") ?? headerText.match(/Project #:\s*(\S+)/)?.[1] ?? "",
    projectName: first(project, "Project Name"),
    facilityName: first(project, "Facility Name"),
    locationAddress: loc.address,
    city: loc.city,
    state: loc.state,
    zip: loc.zip,
    county: first(project, "Location County"),
    startDate: parseTdlrDate(first(project, "Start Date")),
    completionDate: parseTdlrDate(first(project, "Completion Date")),
    estimatedCost: parseMoney(first(project, "Estimated Cost")),
    workTypeLabel: first(project, "Type of Work"),
    fundsType: first(project, "Type of Funds"),
    scopeOfWork: first(project, "Scope of Work"),
    squareFootage: parseSqft(first(project, "Square Footage")),
    tenantFunded: tenant == null ? null : /^yes/i.test(tenant),
    statusLabel: first(project, "Current Status"),
    registrationDate: parseTdlrDate(regMatch?.[1]),
    contactName: first(contact, "Contact Name"),
    rasName: first(ras, "RAS Name"),
    rasPhone: first(ras, "RAS Phone"),
    ownerName: first(owner, "Owner Name"),
    ownerAddress: ownerAddr.length ? ownerAddr.join(", ") : null,
    ownerPhone: first(owner, "Owner Phone"),
    tenantName: sectionName($, ".project-details-tenant", "Tenant Name"),
    designFirmName: sectionName($, ".project-details-designer", "Design Firm Name"),
  };
}
