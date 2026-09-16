type ProviderRule = { slug: string; pattern: RegExp; needsContext: boolean };

const CONTEXT = /\b(internet|wifi|wi-fi|fiber|broadband|powered|provided|service|network|business)\b/i;

const RULES: ProviderRule[] = [
  { slug: "att", pattern: /\bat\s?&\s?t\b/i, needsContext: false },
  { slug: "xfinity", pattern: /\bxfinity\b/i, needsContext: false },
  { slug: "comcast", pattern: /\bcomcast\b/i, needsContext: false },
  { slug: "tmobile", pattern: /\bt[\s-]?mobile\b/i, needsContext: false },
  { slug: "google_fiber", pattern: /\bgoogle fiber\b/i, needsContext: false },
  { slug: "tachus", pattern: /\btachus\b/i, needsContext: false },
  { slug: "spectrum", pattern: /\bspectrum\b/i, needsContext: true },
  { slug: "charter", pattern: /\bcharter\b/i, needsContext: true },
  { slug: "verizon", pattern: /\bverizon\b/i, needsContext: true },
  { slug: "frontier", pattern: /\bfrontier\b/i, needsContext: true },
];

function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function detectProvider(text: string): { provider: string; evidence: string } | null {
  if (!text) return null;
  for (const sentence of sentences(text)) {
    for (const rule of RULES) {
      if (!rule.pattern.test(sentence)) continue;
      if (rule.needsContext && !CONTEXT.test(sentence)) continue;
      return { provider: rule.slug, evidence: sentence.slice(0, 200) };
    }
  }
  return null;
}
