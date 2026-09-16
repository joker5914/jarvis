const THEME_CYCLE = ["light", "dark", "system"] as const;
export type CycleTheme = (typeof THEME_CYCLE)[number];

/** Pure helper: light -> dark -> system -> light. An unrecognized/undefined
 * current value (e.g. before next-themes has resolved one) starts at "light". */
export function nextTheme(current: string | undefined): CycleTheme {
  const idx = THEME_CYCLE.indexOf(current as CycleTheme);
  return THEME_CYCLE[(idx + 1) % THEME_CYCLE.length];
}
