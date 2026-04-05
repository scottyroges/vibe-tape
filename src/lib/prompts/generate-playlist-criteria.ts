/**
 * Prompt builder + validator for the Claude-generated playlist criteria.
 *
 * Given a set of seed tracks (and an optional user intent string), asks
 * Claude Haiku to produce:
 *   - a single target `VibeProfile`
 *   - a short vibe name (≤60 chars)
 *   - a one-line vibe description (≤120 chars)
 *
 * The full canonical mood + genre vocabularies are inlined into the
 * prompt so Claude picks from the explicit lists instead of improvising
 * off-vocab strings. This is ~600 tokens of overhead on Haiku — rounding
 * error at personal-use scale, and it eliminates a whole class of
 * normalizer edge cases.
 *
 * See: docs/plans/completed/playlist-generation-hybrid.md (PR B).
 */

import {
  CANONICAL_MOODS,
  type CanonicalMood,
} from "@/lib/prompts/classify-tracks";
import { normalizeClaudeMood } from "@/lib/prompts/canonical-mood";
import { GENRE_VOCAB, type VibeProfile } from "@/lib/vibe-profile";

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

/**
 * Minimal seed-track shape passed to the prompt. Callers build this from
 * their own track repository rows — scoring-field shape is a superset of
 * `VibeProfile` with name/artist attached for prompt display.
 */
export type PlaylistCriteriaSeed = {
  name: string;
  artist: string;
  mood: CanonicalMood | null;
  energy: "low" | "medium" | "high" | null;
  danceability: "low" | "medium" | "high" | null;
  genres: readonly string[];
  tags: readonly string[];
};

export type PlaylistCriteria = {
  target: VibeProfile;
  vibeName: string;
  vibeDescription: string;
};

// ──────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────

export const VIBE_NAME_MAX_LENGTH = 60;
export const VIBE_DESCRIPTION_MAX_LENGTH = 120;

const VALID_ENERGY_LEVELS: ReadonlySet<string> = new Set([
  "low",
  "medium",
  "high",
]);

const MOOD_LIST = CANONICAL_MOODS.join(", ");
const GENRE_LIST = Array.from(GENRE_VOCAB).sort().join(", ");

/**
 * Tag examples are illustrative only — unlike mood/genre, the tag
 * vocabulary is open. The prompt shows Claude the vibe of what a tag
 * should look like without constraining it.
 */
const TAG_EXAMPLES = [
  "summer",
  "driving",
  "late-night",
  "rainy-day",
  "workout",
  "introspective",
  "catchy",
  "nostalgic-90s",
];

// ──────────────────────────────────────────────────────────────────────────
// Prompt builder
// ──────────────────────────────────────────────────────────────────────────

/**
 * Build the system + user prompt for the playlist-criteria generation.
 *
 * Passing `undefined` or an empty/whitespace-only `userIntent` produces a
 * seed-only prompt with no intent block (identical to calling without
 * the argument). Any other string is included verbatim in the prompt as
 * explicit vibe guidance alongside the seeds.
 */
export function buildPlaylistCriteriaPrompt(
  seeds: readonly PlaylistCriteriaSeed[],
  userIntent?: string,
): { system: string; user: string } {
  const trimmedIntent = userIntent?.trim() ?? "";
  const hasIntent = trimmedIntent.length > 0;

  const system = `You are a music curation assistant. Given a set of seed tracks (and optionally a short user-provided description of the vibe), produce a single target vibe profile that captures what a playlist grown from these seeds should feel like.

Return a JSON object with exactly these top-level keys: target, vibeName, vibeDescription.

The "target" object must have exactly these keys:
- mood: one of the canonical moods below, or null if no single mood fits
- energy: "low" | "medium" | "high" | null
- danceability: "low" | "medium" | "high" | null
- genres: array of 1-8 genres, each chosen from the canonical genre list below
- tags: array of 2-8 short descriptor tags (tags are open vocabulary — see examples)

Canonical moods (pick exactly one, or null):
${MOOD_LIST}

Canonical genres (pick from this list only — do not invent new genres):
${GENRE_LIST}

Example tags (open vocabulary — use any short descriptor in this style):
${TAG_EXAMPLES.join(", ")}

Also return:
- vibeName: a short, evocative name for the playlist, under ${VIBE_NAME_MAX_LENGTH} characters
- vibeDescription: a one-sentence description of the vibe, under ${VIBE_DESCRIPTION_MAX_LENGTH} characters

Respond ONLY with the JSON object. No markdown, no prose, no code fences.

Example response:
{"target":{"mood":"uplifting","energy":"high","danceability":"high","genres":["hip-hop","pop","funk"],"tags":["summer","driving","catchy"]},"vibeName":"Summer Shotgun","vibeDescription":"Windows-down anthems you scream along to."}`;

  const seedsBlock = JSON.stringify(
    seeds.map((s) => ({
      name: s.name,
      artist: s.artist,
      mood: s.mood,
      energy: s.energy,
      danceability: s.danceability,
      genres: s.genres,
      tags: s.tags,
    })),
  );

  const userParts = [`Seed tracks:\n${seedsBlock}`];
  if (hasIntent) {
    userParts.push(
      `User intent: ${trimmedIntent}\n\nUse the user intent as primary guidance when it conflicts with the seeds — the seeds show what's in the user's library, but the intent describes where they want to take it.`,
    );
  }

  return { system, user: userParts.join("\n\n") };
}

// ──────────────────────────────────────────────────────────────────────────
// Response validator
// ──────────────────────────────────────────────────────────────────────────

/**
 * Validate + normalize a raw Claude response into a `PlaylistCriteria`,
 * or return `null` if any field is malformed. The Inngest caller treats
 * null as a retry signal.
 *
 * Mood normalization (case/whitespace) happens inside the validator via
 * `normalizeClaudeMood`, so a response with `"Uplifting"` is accepted
 * and stored as canonical `"uplifting"`.
 */
export function parsePlaylistCriteriaResponse(
  raw: unknown,
): PlaylistCriteria | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  const target = parseTarget(obj.target);
  if (!target) return null;

  const vibeName = parseBoundedString(obj.vibeName, VIBE_NAME_MAX_LENGTH);
  if (!vibeName) return null;

  const vibeDescription = parseBoundedString(
    obj.vibeDescription,
    VIBE_DESCRIPTION_MAX_LENGTH,
  );
  if (!vibeDescription) return null;

  return { target, vibeName, vibeDescription };
}

function parseTarget(raw: unknown): VibeProfile | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  const mood = normalizeClaudeMood(obj.mood);
  if (mood === undefined) return null;

  const energy = parseOrdinalLevel(obj.energy);
  if (energy === undefined) return null;

  const danceability = parseOrdinalLevel(obj.danceability);
  if (danceability === undefined) return null;

  // Reject empty arrays — a target with zero genres *and* zero tags
  // provides almost no scoring signal, and the prompt explicitly asks
  // Claude for 1-8 genres + 2-8 tags. If Claude returns empty arrays
  // it's a malformed response, not a deliberate choice; retry.
  const genres = parseNonEmptyStringArray(obj.genres);
  if (!genres) return null;

  const tags = parseNonEmptyStringArray(obj.tags);
  if (!tags) return null;

  return { mood, energy, danceability, genres, tags };
}

function parseOrdinalLevel(
  raw: unknown,
): "low" | "medium" | "high" | null | undefined {
  if (raw === null) return null;
  if (typeof raw !== "string") return undefined;
  return VALID_ENERGY_LEVELS.has(raw)
    ? (raw as "low" | "medium" | "high")
    : undefined;
}

function parseNonEmptyStringArray(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  if (raw.length === 0) return null;
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") return null;
    const trimmed = item.trim();
    if (trimmed.length === 0) return null;
    out.push(trimmed);
  }
  return out;
}

function parseBoundedString(raw: unknown, maxLength: number): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > maxLength) return null;
  return trimmed;
}
