export function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function timeAgo(d: Date | string): string {
  const ms = Date.now() - new Date(d).getTime();
  const m = Math.round(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  return `${Math.round(h / 24)} d ago`;
}

export function titleCase(slug: string | null | undefined): string {
  return (slug ?? "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Formats a `YYYY-MM-DD` local-date string as "Oct 16" without going through the viewer's own
 * timezone (a plain `new Date("2026-10-16")` is midnight UTC, which a US timezone would render as
 * the previous day) — forces UTC on both the parse and the format so the date never shifts.
 * Whole-branch review L8: this used to be copy-pasted verbatim in both ProviderKeysCard.tsx and
 * EnrichmentCard.tsx; deduped here since both settings cards need the exact same rule. */
export function formatMonthDayUtc(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
