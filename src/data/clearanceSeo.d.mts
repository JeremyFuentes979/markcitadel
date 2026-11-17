export const CLEARANCE_EXAMPLES: readonly { name: string; kind: string }[];

export function nameToSlug(name: string): string;

export function slugToName(slug: string): string | null;

export function exampleBySlug(
  slug: string,
): { name: string; kind: string } | null;

export function displayNameForSlug(slug: string): string | null;

export function relatedExamples(
  slug: string,
  n?: number,
): { name: string; kind: string; slug: string }[];

export function pageCopy(
  name: string,
  kind?: string,
): {
  title: string;
  description: string;
  faqs: { q: string; a: string }[];
};
