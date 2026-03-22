// @vitest-environment node
import { describe, it, expect } from "vitest";
import { CURRENT_ENRICHMENT_VERSION, deriveEra } from "@/lib/enrichment";

describe("CURRENT_ENRICHMENT_VERSION", () => {
  it("exports version 1", () => {
    expect(CURRENT_ENRICHMENT_VERSION).toBe(1);
  });
});

describe("deriveEra", () => {
  it("derives decade from full date", () => {
    expect(deriveEra("2023-06-15")).toBe("2020s");
  });

  it("derives decade from year-month", () => {
    expect(deriveEra("2023-06")).toBe("2020s");
  });

  it("derives decade from year only", () => {
    expect(deriveEra("2023")).toBe("2020s");
  });

  it("handles 1990s", () => {
    expect(deriveEra("1995-01-01")).toBe("1990s");
  });

  it("handles 1960s", () => {
    expect(deriveEra("1969-12-31")).toBe("1960s");
  });

  it("handles decade boundary", () => {
    expect(deriveEra("2000-01-01")).toBe("2000s");
  });

  it("returns null for null input", () => {
    expect(deriveEra(null)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(deriveEra("")).toBeNull();
  });

  it("returns null for invalid string", () => {
    expect(deriveEra("not-a-date")).toBeNull();
  });
});
