/** Shared types + class presets for the trademark conflict summary. */

export type Verdict = "high" | "possible" | "clear" | "unknown";

export interface FlaggedMark {
  serialNumber: string;
  wordmark: string;
  owner: string | null;
  classes: number[];
  registered: boolean;
  status: string | null;
  registrationNumber: string | null;
  url: string;
  score: number; // 0-100
  similarity: "exact" | "sound-alike" | "contains" | "similar spelling" | "shares a word";
  inYourClasses: boolean;
  reasons: string[];
}

export interface OwnerSummary {
  owner: string;
  liveMarks: number; // live marks for this word in the sample
  classes: number[];
}

export interface ConflictSummary {
  query: string;
  classes: number[]; // classes the user picked (or defaults)
  verdict: Verdict;
  headline: string;
  explanation: string;
  counts: {
    total: number; // all statuses, matching name / variants
    live: number;
    liveInYourClasses: number;
    exactLive: number;
    analyzed: number; // live marks actually fetched + scored
  };
  topConflicts: FlaggedMark[];
  topOwners: OwnerSummary[];
  degraded: string | null;
  disclaimer: string;
  generatedAt: string;
}

export const CONFLICT_DISCLAIMER =
  "Automated screening, not legal advice. It compares wording, sound, status and classes of federal USPTO marks only, not state or unregistered (common-law) use. Talk to a trademark attorney before you file or invest in a name.";

/** Nice classes, short labels. */
export const NICE_CLASSES: Record<number, string> = {
  1: "Chemicals", 2: "Paints", 3: "Cosmetics & cleaning", 4: "Fuels & lubricants",
  5: "Pharmaceuticals", 6: "Metal goods", 7: "Machinery", 8: "Hand tools",
  9: "Software & electronics", 10: "Medical devices", 11: "HVAC, lighting & plumbing fixtures",
  12: "Vehicles", 13: "Firearms", 14: "Jewelry", 15: "Musical instruments",
  16: "Paper & printed matter", 17: "Rubber & insulation", 18: "Leather goods & bags",
  19: "Building materials", 20: "Furniture", 21: "Housewares", 22: "Ropes & tents",
  23: "Yarns", 24: "Textiles", 25: "Clothing", 26: "Lace & notions", 27: "Carpets",
  28: "Toys & sporting goods", 29: "Meat, dairy & processed food", 30: "Coffee, bakery & staples",
  31: "Fresh produce & animals", 32: "Beer & soft drinks", 33: "Wine & spirits", 34: "Tobacco",
  35: "Advertising & business services", 36: "Finance, insurance & real estate",
  37: "Construction, repair & installation", 38: "Telecommunications", 39: "Transport & storage",
  40: "Treatment of materials", 41: "Education & entertainment", 42: "Software, SaaS & tech services",
  43: "Restaurants & lodging", 44: "Medical, beauty & landscaping", 45: "Legal & security services",
};

export const DEFAULT_CLASSES = [9, 35, 42, 45];

/** "What's your business?" presets → Nice classes. */
export const BUSINESS_PRESETS: { id: string; label: string; classes: number[] }[] = [
  { id: "software", label: "Software / online service", classes: [9, 35, 42, 45] },
  { id: "home-services", label: "Home services (HVAC, plumbing, roofing, cleaning)", classes: [35, 37, 11, 44] },
  { id: "construction", label: "Construction / remodeling", classes: [37, 35, 19, 42] },
  { id: "restaurant", label: "Restaurant / food & drink", classes: [43, 30, 29, 32, 35] },
  { id: "retail-apparel", label: "Clothing / apparel brand", classes: [25, 35, 18, 14] },
  { id: "beauty", label: "Beauty, salon & wellness", classes: [44, 3, 35, 41] },
  { id: "finance", label: "Finance, insurance & real estate", classes: [36, 35, 9, 42] },
  { id: "health", label: "Medical / health practice", classes: [44, 5, 10, 35] },
  { id: "education", label: "Education, coaching & events", classes: [41, 35, 9, 16] },
  { id: "consulting", label: "Consulting / agency / marketing", classes: [35, 41, 42, 45] },
  { id: "transport", label: "Moving, delivery & logistics", classes: [39, 35, 12] },
];

/** Classes persisted in the URL as ?classes=9,35 */
export function parseClassesParam(v: string | null): number[] {
  const out = (v ?? "")
    .split(",")
    .map((x) => parseInt(x, 10))
    .filter((n) => n >= 1 && n <= 45);
  return out.length ? [...new Set(out)].sort((a, b) => a - b) : DEFAULT_CLASSES;
}
