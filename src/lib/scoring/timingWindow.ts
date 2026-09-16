import { PROJECT_CONFIG, TDLR_STATUS_CLOSED } from "@/lib/config/projects";

export type TimingWindowValue = "opening_soon" | "under_construction" | "planned" | "just_completed" | "stale";

const DAY = 86_400_000;

export function timingWindowFor(
  p: { startDate: Date | null; completionDate: Date | null; statusCode: number | null },
  now: Date = new Date(),
): TimingWindowValue | null {
  if (p.statusCode === TDLR_STATUS_CLOSED) return "stale";
  const t = now.getTime();
  if (p.completionDate) {
    const untilDone = (p.completionDate.getTime() - t) / DAY;
    if (untilDone < 0) return -untilDone <= PROJECT_CONFIG.justCompletedDays ? "just_completed" : "stale";
    if (untilDone <= PROJECT_CONFIG.openingSoonDays) return "opening_soon";
    if (p.startDate && p.startDate.getTime() > t) return "planned";
    return "under_construction";
  }
  if (p.startDate) return p.startDate.getTime() > t ? "planned" : "under_construction";
  return null;
}
