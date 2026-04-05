/**
 * Shared helper for normalizing mood strings returned by Claude into the
 * canonical vocabulary.
 *
 * Originally lived as a file-local helper in `sync-library.ts`. Extracted
 * here so both the classification pipeline and the playlist-criteria
 * generator validate moods through a single source of truth — adding a
 * third caller (e.g. an ad-hoc re-enrichment job) doesn't copy-paste the
 * normalizer again.
 *
 * `CANONICAL_MOODS` / `CanonicalMood` stay in `classify-tracks.ts` as the
 * vocabulary source of truth; this module only owns the normalization
 * behavior.
 */

import {
  CANONICAL_MOODS,
  type CanonicalMood,
} from "@/lib/prompts/classify-tracks";

const CANONICAL_MOOD_SET: ReadonlySet<string> = new Set(CANONICAL_MOODS);

/**
 * Normalize a raw mood value from Claude into a canonical mood or null.
 *
 * - `null` stays `null` (Claude's explicit "no canonical fit" signal).
 * - A string matching a canonical mood (case/whitespace-insensitive) is
 *   returned in its canonical (lowercase, trimmed) form.
 * - Anything else — off-list strings, non-strings, empty strings — returns
 *   `undefined`, which callers treat as a validation failure.
 */
export function normalizeClaudeMood(
  raw: unknown,
): CanonicalMood | null | undefined {
  if (raw === null) return null;
  if (typeof raw !== "string") return undefined;
  const normalized = raw.toLowerCase().trim();
  return CANONICAL_MOOD_SET.has(normalized)
    ? (normalized as CanonicalMood)
    : undefined;
}
