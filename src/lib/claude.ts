import Anthropic from "@anthropic-ai/sdk";
import type { Message } from "@anthropic-ai/sdk/resources/messages";
import type { ClassificationResult } from "@/lib/prompts/classify-tracks";

const anthropic = new Anthropic();

const HAIKU_MODEL = "claude-haiku-4-5-20251001";

export class ClaudeParseError extends Error {
  readonly rawResponse: string;

  constructor(message: string, rawResponse: string) {
    super(message);
    this.name = "ClaudeParseError";
    this.rawResponse = rawResponse;
  }
}

/**
 * Extract the text content of a Claude response, strip optional markdown
 * code fences, and parse as JSON. Throws `ClaudeParseError` with the raw
 * text attached when the response isn't valid JSON — callers catch and
 * retry at the Inngest layer.
 */
function parseJsonFromClaude(response: Message): unknown {
  let text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

  // Strip markdown code fences if present
  text = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");

  try {
    return JSON.parse(text);
  } catch {
    throw new ClaudeParseError(
      `Failed to parse Claude response as JSON: ${text.slice(0, 200)}`,
      text,
    );
  }
}

export async function classifyTracks(
  system: string,
  user: string,
): Promise<{
  results: ClassificationResult[];
  inputTokens: number;
  outputTokens: number;
}> {
  const response = await anthropic.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 4096,
    system,
    messages: [{ role: "user", content: user }],
  });

  const parsed = parseJsonFromClaude(response);

  if (!Array.isArray(parsed)) {
    throw new ClaudeParseError(
      `Expected JSON array, got ${typeof parsed}`,
      JSON.stringify(parsed),
    );
  }

  // Elements are not shape-validated here — callers must validate per-track fields
  return {
    results: parsed as ClassificationResult[],
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}

/**
 * Call Claude Haiku with a playlist-criteria generation prompt and return
 * the raw parsed JSON object plus token usage. Shape validation lives in
 * `parsePlaylistCriteriaResponse` — keep this function narrow so the
 * Inngest caller can retry on validation failures without this layer
 * knowing anything about the criteria schema.
 */
export async function generatePlaylistCriteria(
  system: string,
  user: string,
): Promise<{ raw: unknown; inputTokens: number; outputTokens: number }> {
  const response = await anthropic.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 1024,
    system,
    messages: [{ role: "user", content: user }],
  });

  return {
    raw: parseJsonFromClaude(response),
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}
