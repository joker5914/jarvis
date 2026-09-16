export type ExclusionConfig = {
  /** lowercase substrings matched against the lowercase business/project name */
  chains: string[];
  /** patterns for government, education, health systems */
  entityPatterns: RegExp[];
  positiveKeywords: string[];
  softNegativeKeywords: string[];
  costHardLimit: number;
  sameNameLimit: number;
};

export const DEFAULT_EXCLUSION_CONFIG: ExclusionConfig = {
  chains: [
    "walmart", "h-e-b", "heb ", "kroger", "starbucks", "mcdonald", "cvs", "walgreens",
    "home depot", "lowe's", "target", "costco", "sam's club", "chick-fil-a", "whataburger",
    "taco bell", "wendy's", "burger king", "subway", "domino", "pizza hut", "dunkin",
    "7-eleven", "shell", "exxon", "chevron", "buc-ee", "memorial hermann", "methodist",
    "hca ", "texas children", "kelsey-seybold", "md anderson", "st. luke", "baylor",
    "amazon", "fedex", "ups store", "bank of america", "chase", "wells fargo",
  ],
  entityPatterns: [
    /\bisd\b/i,
    /\bcity of\b/i,
    /\bcounty\b/i,
    /\bhospital\b/i,
    /\bmedical center\b/i,
    /\buniversity\b/i,
    /\bcollege\b/i,
    /\bfederal\b/i,
    /\busps\b/i,
    /\bpost office\b/i,
    /\bschool district\b/i,
    /\bmetro\b/i,
    /\bport of\b/i,
  ],
  positiveKeywords: [
    "salon", "nails", "spa", "barber", "coffee", "cafe", "bakery", "taqueria", "restaurant",
    "bar", "grill", "boutique", "dental", "dentist", "chiropractic", "optometry", "daycare",
    "day care", "fitness", "yoga", "pilates", "tutoring", "clinic", "veterinary", "pet",
    "cleaners", "auto", "tire", "insurance", "realty", "law office", "cpa",
  ],
  softNegativeKeywords: [
    "apartments", "church", "school", "park", "sidewalk", "warehouse", "distribution",
    "industrial", "building 0",
  ],
  costHardLimit: 2_000_000,
  sameNameLimit: 5,
};
