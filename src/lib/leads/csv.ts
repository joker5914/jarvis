import type { LeadRow } from "./queries";

const HEADER = [
  "name", "category", "zip", "address", "phone", "website", "emails", "socials",
  "quality_band", "quality_score", "outreach_status", "suggested_package", "current_provider",
  "products_pitched", "tags", "notes",
];

function cell(v: unknown): string {
  let s = v == null ? "" : String(v);
  // Neutralize spreadsheet formula prefixes
  if (s && /^[=+\-@\t\r]/.test(s)) {
    s = "'" + s;
  }
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function businessesToCsv(rows: LeadRow[]): string {
  const lines = [HEADER.join(",")];
  for (const b of rows) {
    const emails = b.contacts.filter((c) => c.type === "email").map((c) => c.value).join("; ");
    const socials = b.contacts
      .filter((c) => ["linkedin", "facebook", "instagram", "twitter", "yelp"].includes(c.type))
      .map((c) => c.value)
      .join("; ");
    lines.push(
      [
        b.name, b.primaryCategory, b.zip, b.formattedAddress, b.phone, b.websiteUrl, emails, socials,
        b.contactQualityBand, b.contactQualityScore, b.outreachStatus, b.suggestedPackage, b.currentProviderHint,
        b.productsPitched.join("; "), b.tags.map((t) => t.tag.name).join("; "), b.notes,
      ]
        .map(cell)
        .join(","),
    );
  }
  return lines.join("\r\n");
}
