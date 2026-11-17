/** Shared by the site and the post-build SEO prerender. Keep this file plain JS. */

export const CLEARANCE_EXAMPLES = [
  { name: "Austin Plumbing Co", kind: "home service" },
  { name: "Houston Roofing", kind: "home service" },
  { name: "Dallas Electric", kind: "home service" },
  { name: "San Antonio HVAC", kind: "home service" },
  { name: "Fort Worth Lawn Care", kind: "home service" },
  { name: "Hill Country Dental", kind: "professional" },
  { name: "Lone Star Cleaning", kind: "home service" },
  { name: "Gulf Coast Painting", kind: "home service" },
  { name: "West Texas Solar", kind: "home service" },
  { name: "Rio Grande Landscaping", kind: "home service" },
  { name: "Bluebonnet Pediatrics", kind: "professional" },
  { name: "Magnolia Bookkeeping", kind: "professional" },
  { name: "Pecan Street Coffee", kind: "local brand" },
  { name: "Barton Creek Fitness", kind: "local brand" },
  { name: "Elm Street Bakery", kind: "local brand" },
  { name: "Northloop Storage", kind: "local brand" },
  { name: "Cedar Post Fence", kind: "home service" },
  { name: "Prairie Dog Pest Control", kind: "home service" },
  { name: "Alamo Auto Glass", kind: "home service" },
  { name: "Trinity River Yoga", kind: "local brand" },
  { name: "Mesa Trail Outfitters", kind: "local brand" },
  { name: "Harbor Lane Consulting", kind: "professional" },
  { name: "Kindred Ledger", kind: "startup" },
  { name: "Northstar Dispatch", kind: "startup" },
  { name: "Brightpath Tutoring", kind: "professional" },
  { name: "Copper Kettle Catering", kind: "local brand" },
  { name: "Redbird Roofing", kind: "home service" },
  { name: "Oak and Iron Fabrication", kind: "home service" },
  { name: "Summit Dental Studio", kind: "professional" },
  { name: "Hometown HVAC", kind: "home service" },
];

export function nameToSlug(name) {
  return String(name)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** Title-case a clean slug, or null when the slug is not a public name URL. */
export function slugToName(slug) {
  const raw = String(slug ?? "");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(raw)) return null;
  if (raw.length < 2 || raw.length > 60) return null;
  if (!/[a-z]/.test(raw)) return null;
  return raw
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function exampleBySlug(slug) {
  return CLEARANCE_EXAMPLES.find((e) => nameToSlug(e.name) === slug) ?? null;
}

export function displayNameForSlug(slug) {
  const known = exampleBySlug(slug);
  if (known) return known.name;
  return slugToName(slug);
}

export function relatedExamples(slug, n = 4) {
  const all = CLEARANCE_EXAMPLES.map((e) => ({
    ...e,
    slug: nameToSlug(e.name),
  })).filter((e) => e.slug !== slug);
  if (!all.length) return [];
  let h = 0;
  for (const c of String(slug)) h = (h * 33 + c.charCodeAt(0)) >>> 0;
  const start = h % all.length;
  const count = Math.min(n, all.length);
  return Array.from({ length: count }, (_, i) => all[(start + i) % all.length]);
}

export function pageCopy(name, kind) {
  const trade = kind ? ` for this ${kind}` : "";
  return {
    title: `Is ${name} trademarked?`,
    description: `Free USPTO screen for "${name}"${trade}. See live federal trademarks, then unlock the $29 Name Clearance Report or ask for a trademark attorney introduction. Not legal advice.`,
    faqs: [
      {
        q: `Is ${name} trademarked?`,
        a: `MarkCitadel checks live federal trademark records for "${name}" and close spellings. A match is a conflict to review, not an automatic block. State LLC names, common-law use, and foreign registrations are separate.`,
      },
      {
        q: `Can I use ${name} if the free check looks quiet?`,
        a: `A quiet screen is a starting point, not a clearance opinion. The $29 report is the PDF you can hand a partner or attorney. A licensed trademark attorney is the one who can tell you whether to file.`,
      },
      {
        q: "What does the $29 Name Clearance Report include?",
        a: "A risk verdict for the classes you picked, up to 10 scored conflicting marks with owners and serial numbers, domain status, sound-alike spellings, and a checklist. One-time payment. Not a law-firm opinion.",
      },
    ],
  };
}
