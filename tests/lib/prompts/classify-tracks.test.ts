import { describe, it, expect } from "vitest";
import { buildClassifyPrompt } from "@/lib/prompts/classify-tracks";

describe("buildClassifyPrompt", () => {
  it("returns a stable system prompt", () => {
    const { system } = buildClassifyPrompt([]);
    expect(system).toMatchSnapshot();
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
