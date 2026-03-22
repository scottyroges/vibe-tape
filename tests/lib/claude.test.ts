// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockCreate } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: mockCreate };
  },
}));

import { classifyTracks, ClaudeParseError } from "@/lib/claude";

describe("classifyTracks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("parses valid JSON response with token counts", async () => {
    const classifications = [
      { mood: "uplifting", energy: "high", danceability: "medium", vibeTags: ["summer", "driving"] },
    ];
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify(classifications) }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const result = await classifyTracks("system", "user");

    expect(result.results).toEqual(classifications);
    expect(result.inputTokens).toBe(100);
    expect(result.outputTokens).toBe(50);
  });

  it("throws ClaudeParseError on malformed JSON", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "not json at all" }],
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    await expect(classifyTracks("system", "user")).rejects.toThrow(ClaudeParseError);
    await expect(classifyTracks("system", "user")).rejects.toThrow("Failed to parse");
  });

  it("throws ClaudeParseError when response is not an array", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: '{"mood":"happy"}' }],
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    await expect(classifyTracks("system", "user")).rejects.toThrow(ClaudeParseError);
    await expect(classifyTracks("system", "user")).rejects.toThrow("Expected JSON array");
  });
});
