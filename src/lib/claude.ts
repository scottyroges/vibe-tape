import Anthropic from "@anthropic-ai/sdk";
import type { ClassificationResult } from "@/lib/prompts/classify-tracks";

const anthropic = new Anthropic();

export class ClaudeParseError extends Error {
  readonly rawResponse: string;

  constructor(message: string, rawResponse: string) {
    super(message);
    this.name = "ClaudeParseError";
    this.rawResponse = rawResponse;
  }
}

export async function classifyTracks(
  system: string,
  user: string
): Promise<{
  results: ClassificationResult[];
  inputTokens: number;
  outputTokens: number;
}> {
  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 4096,
    system,
    messages: [{ role: "user", content: user }],
  });

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ClaudeParseError(`Failed to parse Claude response as JSON: ${text.slice(0, 200)}`, text);
  }

  if (!Array.isArray(parsed)) {
    throw new ClaudeParseError(`Expected JSON array, got ${typeof parsed}`, text);
  }

  // Elements are not shape-validated here — callers must validate per-track fields
  return {
    results: parsed as ClassificationResult[],
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}
