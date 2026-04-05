// @vitest-environment node
import { describe, it, expect } from "vitest";
import { normalizeClaudeMood } from "@/lib/prompts/canonical-mood";

describe("normalizeClaudeMood", () => {
  it("returns null for explicit null input", () => {
    expect(normalizeClaudeMood(null)).toBeNull();
  });

  it("returns undefined for non-string input", () => {
    expect(normalizeClaudeMood(42)).toBeUndefined();
    expect(normalizeClaudeMood(undefined)).toBeUndefined();
    expect(normalizeClaudeMood({})).toBeUndefined();
    expect(normalizeClaudeMood([])).toBeUndefined();
    expect(normalizeClaudeMood(true)).toBeUndefined();
  });

  it("accepts a canonical mood exactly", () => {
    expect(normalizeClaudeMood("uplifting")).toBe("uplifting");
    expect(normalizeClaudeMood("melancholic")).toBe("melancholic");
    expect(normalizeClaudeMood("peaceful")).toBe("peaceful");
  });

  it("accepts canonical moods with varying case", () => {
    expect(normalizeClaudeMood("Uplifting")).toBe("uplifting");
    expect(normalizeClaudeMood("MELANCHOLIC")).toBe("melancholic");
    expect(normalizeClaudeMood("DaRk")).toBe("dark");
  });

  it("strips surrounding whitespace", () => {
    expect(normalizeClaudeMood("  energetic  ")).toBe("energetic");
    expect(normalizeClaudeMood("\tplayful\n")).toBe("playful");
  });

  it("returns undefined for off-list moods", () => {
    expect(normalizeClaudeMood("ethereal")).toBeUndefined();
    expect(normalizeClaudeMood("angry")).toBeUndefined();
    expect(normalizeClaudeMood("chill")).toBeUndefined();
  });

  it("returns undefined for empty or whitespace strings", () => {
    expect(normalizeClaudeMood("")).toBeUndefined();
    expect(normalizeClaudeMood("   ")).toBeUndefined();
  });
});
