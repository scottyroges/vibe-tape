import { describe, it, expect } from "vitest";
import {
  buildClassifyPrompt,
  CANONICAL_MOODS,
} from "@/lib/prompts/classify-tracks";

describe("buildClassifyPrompt", () => {
  it("returns a stable system prompt", () => {
    const { system } = buildClassifyPrompt([]);
    expect(system).toMatchSnapshot();
  });

  it("system prompt includes all 11 canonical moods", () => {
    const { system } = buildClassifyPrompt([]);
    for (const mood of CANONICAL_MOODS) {
      expect(system).toContain(mood);
    }
  });

  it("system prompt instructs Claude to return null for non-matching tracks", () => {
    const { system } = buildClassifyPrompt([]);
    expect(system).toContain("mood: null");
    expect(system).toContain("Do not invent new moods");
  });

  it("serializes tracks as JSON array in user prompt", () => {
    const { user } = buildClassifyPrompt([
      { name: "Bohemian Rhapsody", artist: "Queen" },
      { name: "Stairway to Heaven", artist: "Led Zeppelin" },
    ]);

    const parsed = JSON.parse(user);
    expect(parsed).toEqual([
      { name: "Bohemian Rhapsody", artist: "Queen" },
      { name: "Stairway to Heaven", artist: "Led Zeppelin" },
    ]);
  });

  it("handles empty array input", () => {
    const { user } = buildClassifyPrompt([]);
    expect(JSON.parse(user)).toEqual([]);
  });
});

describe("CANONICAL_MOODS", () => {
  it("exports exactly 11 canonical moods", () => {
    expect(CANONICAL_MOODS).toHaveLength(11);
  });

  it("contains the expected canonical vocabulary", () => {
    expect([...CANONICAL_MOODS].sort()).toEqual(
      [
        "aggressive",
        "confident",
        "dark",
        "dreamy",
        "energetic",
        "melancholic",
        "nostalgic",
        "peaceful",
        "playful",
        "romantic",
        "uplifting",
      ].sort()
    );
  });
});
