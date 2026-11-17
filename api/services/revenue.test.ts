import { describe, expect, it } from "vitest";
import { reportCheckoutRate } from "./revenue";

describe("reportCheckoutRate", () => {
  it("returns a one-decimal percent", () => {
    expect(reportCheckoutRate(200, 7)).toBe(3.5);
  });

  it("returns null when no one has checked a name", () => {
    expect(reportCheckoutRate(0, 0)).toBeNull();
    expect(reportCheckoutRate(-1, 1)).toBeNull();
  });

  it("treats a bad checkout count as unknown", () => {
    expect(reportCheckoutRate(10, -1)).toBeNull();
  });
});
