"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { nextTheme, type CycleTheme } from "@/lib/theme/cycle";

const GLYPH: Record<CycleTheme, string> = {
  light: "☀︎",
  dark: "☾",
  system: "◐",
};

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  // next-themes only knows the real theme after mount (it reads localStorage/media
  // query client-side); rendering the resolved glyph before that would mismatch
  // between the server-rendered markup and the client, so gate on a mounted flag.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <Button variant="ghost" size="icon" aria-label="Toggle theme" data-testid="theme-toggle" disabled>
        <span aria-hidden="true">{GLYPH.system}</span>
      </Button>
    );
  }

  const current = (theme as CycleTheme) ?? "system";
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Toggle theme"
      data-testid="theme-toggle"
      title={`Theme: ${current}`}
      onClick={() => setTheme(nextTheme(current))}
    >
      <span aria-hidden="true">{GLYPH[current]}</span>
    </Button>
  );
}
