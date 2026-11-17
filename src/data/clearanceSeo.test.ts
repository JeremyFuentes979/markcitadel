import { describe, expect, it } from "vitest";
import {
  CLEARANCE_EXAMPLES,
  displayNameForSlug,
  nameToSlug,
  relatedExamples,
  slugToName,
} from "./clearance";

describe("name slugs", () => {
  it("round-trips curated names to stable public URLs", () => {
    const slugs = CLEARANCE_EXAMPLES.map((e) => nameToSlug(e.name));
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(nameToSlug("San Antonio HVAC")).toBe("san-antonio-hvac");
    expect(displayNameForSlug("san-antonio-hvac")).toBe("San Antonio HVAC");
  });

  it("accepts long-tail slugs and rejects junk", () => {
    expect(slugToName("bright-oak-studio")).toBe("Bright Oak Studio");
    expect(slugToName("Nike")).toBeNull();
    expect(slugToName("a--b")).toBeNull();
    expect(slugToName("123")).toBeNull();
    expect(slugToName("../admin")).toBeNull();
  });

  it("suggests other names without repeating the current one", () => {
    const related = relatedExamples("austin-plumbing-co");
    expect(related.length).toBeGreaterThan(0);
    expect(related.every((r) => r.slug !== "austin-plumbing-co")).toBe(true);
  });
});
