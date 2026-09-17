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
    // Plan 9 Task 3: Zumiez, Pet Paradise and H&R Block escaped chain exclusion on the original
    // name-only list; this batch adds the national chains the Apollo headcount signal (see
    // ENRICH_CONFIG.chainHeadcountMin) would otherwise still have to burn a search call to catch.
    // "snap fitness" and "state farm" are deliberately NOT here — both are franchise/agent-owned
    // SMB storefronts, not head-office-run chains, and are real prospects.
    "zumiez", "pet paradise", "h&r block", "jiffy lube", "geico", "petsmart", "petco",
    "great clips", "supercuts", "planet fitness", "la fitness", "24 hour fitness",
    "aspen dental", "banfield", "vca ", "chili's", "applebee", "olive garden", "ihop",
    "denny's", "waffle house", "panda express", "chipotle", "five guys", "raising cane",
    "popeyes", "kfc", "sonic drive", "jack in the box", "dairy queen", "autozone",
    "o'reilly auto", "advance auto", "discount tire", "firestone", "goodyear",
    "mattress firm", "ross dress", "tj maxx", "marshalls", "dollar general", "dollar tree",
    "family dollar", "office depot", "staples", "best buy", "verizon", "at&t", "t-mobile",
    "spectrum", "xfinity",
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
    "industrial", "building",
  ],
  costHardLimit: 2_000_000,
  sameNameLimit: 5,
};
