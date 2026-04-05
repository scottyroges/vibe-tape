/**
 * Pure scoring + ranking primitives for playlist generation.
 *
 * No DB, no I/O. Callers (Inngest functions) load candidate VibeProfiles,
 * compute or fetch the two targets (Claude + math), score each candidate
 * against both, blend to a `finalScore`, and hand the resulting
 * `ScoredTrack[]` to `rankAndFilter`.
 *
 * See: docs/plans/completed/playlist-generation-hybrid.md (PR A).
 */

import { MAX_GENRES, MAX_TAGS, type VibeProfile } from "@/lib/vibe-profile";
import type { CanonicalMood } from "@/lib/prompts/classify-tracks";

// ──────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────

/**
 * Hard cap on playlist length. Spotify's `PUT /playlists/{id}/tracks`
 * body only accepts 100 URIs, and that's the endpoint we use to sync
 * regenerate results back to the live playlist. Going above 100 would
 * require multi-batch PUT+append with no atomicity; a partial failure
 * would leave the Spotify playlist half-replaced. Simpler to cap.
 */
export const MAX_PLAYLIST_TRACKS = 100;

const WEIGHTS = {
  mood: 0.3,
  energy: 0.15,
  danceability: 0.15,
  genres: 0.3,
  tags: 0.1,
} as const;

const ENERGY_ORDINAL: Record<"low" | "medium" | "high", number> = {
  low: 0,
  medium: 1,
  high: 2,
};

const ORDINAL_TO_ENERGY = ["low", "medium", "high"] as const;

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

export type ScoredTrack = {
  trackId: string;
  primaryArtistId: string;
  durationMs: number;
  claudeScore: number;
  mathScore: number;
  finalScore: number;
};

export type RankAndFilterOptions = {
  targetDurationMs: number;
  perArtistCap: number;
  shuffleWindowSize: number;
  /**
   * Track IDs that MUST appear in the output regardless of score or the
   * per-artist cap. Used by generate/regenerate to guarantee seed tracks
   * are always in the playlist. Order is preserved in the pre-shuffle
   * `picked` list. Required tracks count toward the duration budget and
   * bump artist counts, but are exempt from the cap themselves.
   */
  requiredTrackIds?: readonly string[];
  /** Track IDs to skip (top-up passes existing playlist tracks). */
  excludeIds?: ReadonlySet<string>;
  /**
   * Starting per-artist counts. Top-up pre-populates from existing
   * playlist tracks so the cap applies across existing + new.
   */
  initialArtistCounts?: ReadonlyMap<string, number>;
  /**
   * Injectable RNG for the window shuffle — returns numbers in `[0, 1)`.
   * Defaults to `Math.random`. Tests pass a deterministic stub.
   */
  rng?: () => number;
};

// ──────────────────────────────────────────────────────────────────────────
// Math target
// ──────────────────────────────────────────────────────────────────────────

/**
 * Compute the centroid-style target profile from a set of seed profiles.
 *
 * - mood: plurality winner. Ties or all-null → null.
 * - energy / danceability: ordinal average, rounded. Ignores nulls.
 * - genres / tags: dedup union sorted by frequency DESC, capped.
 */
export function computeMathTarget(seeds: readonly VibeProfile[]): VibeProfile {
  return {
    mood: pluralityMood(seeds),
    energy: ordinalAverage(seeds.map((s) => s.energy)),
    danceability: ordinalAverage(seeds.map((s) => s.danceability)),
    genres: frequencySorted(
      seeds.flatMap((s) => s.genres),
      MAX_GENRES,
    ),
    tags: frequencySorted(
      seeds.flatMap((s) => s.tags),
      MAX_TAGS,
    ),
  };
}

function pluralityMood(seeds: readonly VibeProfile[]): CanonicalMood | null {
  const counts = new Map<CanonicalMood, number>();
  for (const seed of seeds) {
    if (seed.mood == null) continue;
    counts.set(seed.mood, (counts.get(seed.mood) ?? 0) + 1);
  }
  if (counts.size === 0) return null;

  let best: CanonicalMood | null = null;
  let bestCount = 0;
  let tied = false;
  for (const [mood, count] of counts) {
    if (count > bestCount) {
      best = mood;
      bestCount = count;
      tied = false;
    } else if (count === bestCount) {
      tied = true;
    }
  }
  return tied ? null : best;
}

function ordinalAverage(
  values: readonly ("low" | "medium" | "high" | null)[],
): "low" | "medium" | "high" | null {
  const nums: number[] = [];
  for (const v of values) {
    if (v == null) continue;
    nums.push(ENERGY_ORDINAL[v]);
  }
  if (nums.length === 0) return null;
  const avg = nums.reduce((sum, n) => sum + n, 0) / nums.length;
  const rounded = Math.round(avg) as 0 | 1 | 2;
  return ORDINAL_TO_ENERGY[rounded];
}

function frequencySorted(items: readonly string[], cap: number): string[] {
  const counts = new Map<string, number>();
  const firstIndex = new Map<string, number>();
  items.forEach((item, i) => {
    counts.set(item, (counts.get(item) ?? 0) + 1);
    if (!firstIndex.has(item)) firstIndex.set(item, i);
  });
  return Array.from(counts.keys())
    .sort((a, b) => {
      const byCount = (counts.get(b) ?? 0) - (counts.get(a) ?? 0);
      if (byCount !== 0) return byCount;
      // Stable tiebreak on first-seen order so callers get deterministic output.
      return (firstIndex.get(a) ?? 0) - (firstIndex.get(b) ?? 0);
    })
    .slice(0, cap);
}

// ──────────────────────────────────────────────────────────────────────────
// Scoring
// ──────────────────────────────────────────────────────────────────────────

/**
 * Weighted similarity between a candidate and a target profile. Returns
 * a number in `[0, 1]`. See the plan for the component table.
 */
export function scoreTrack(
  candidate: VibeProfile,
  target: VibeProfile,
): number {
  const mood = moodSimilarity(candidate.mood, target.mood);
  const energy = ordinalSimilarity(candidate.energy, target.energy);
  const danceability = ordinalSimilarity(
    candidate.danceability,
    target.danceability,
  );
  const genres = jaccard(candidate.genres, target.genres);
  const tags = jaccard(candidate.tags, target.tags);

  return (
    WEIGHTS.mood * mood +
    WEIGHTS.energy * energy +
    WEIGHTS.danceability * danceability +
    WEIGHTS.genres * genres +
    WEIGHTS.tags * tags
  );
}

function moodSimilarity(
  a: CanonicalMood | null,
  b: CanonicalMood | null,
): number {
  if (a == null || b == null) return 0;
  return a === b ? 1 : 0;
}

function ordinalSimilarity(
  a: "low" | "medium" | "high" | null,
  b: "low" | "medium" | "high" | null,
): number {
  if (a == null || b == null) return 0;
  const diff = Math.abs(ENERGY_ORDINAL[a] - ENERGY_ORDINAL[b]);
  if (diff === 0) return 1;
  if (diff === 1) return 0.5;
  return 0;
}

function jaccard(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection += 1;
  }
  const union = setA.size + setB.size - intersection;
  if (union === 0) return 0;
  return intersection / union;
}

/**
 * A target is "degenerate" if it cannot meaningfully score any candidate
 * — every field is null/empty so `scoreTrack` would return ~0 for
 * everything. The blended score falls back to the non-degenerate side.
 */
function isDegenerateTarget(target: VibeProfile): boolean {
  return (
    target.mood == null &&
    target.energy == null &&
    target.danceability == null &&
    target.genres.length === 0 &&
    target.tags.length === 0
  );
}

/**
 * Compute the per-candidate (claudeScore, mathScore, finalScore) triple.
 *
 * `finalScore` is the average of the two component scores, *unless* one
 * target is degenerate — in which case we fall back to the other side
 * only, so the degenerate half doesn't torpedo every track.
 */
export function computeFinalScore(
  candidate: VibeProfile,
  claudeTarget: VibeProfile,
  mathTarget: VibeProfile,
): { claudeScore: number; mathScore: number; finalScore: number } {
  const claudeScore = scoreTrack(candidate, claudeTarget);
  const mathScore = scoreTrack(candidate, mathTarget);

  const claudeDegenerate = isDegenerateTarget(claudeTarget);
  const mathDegenerate = isDegenerateTarget(mathTarget);

  let finalScore: number;
  if (claudeDegenerate && mathDegenerate) {
    finalScore = 0;
  } else if (claudeDegenerate) {
    finalScore = mathScore;
  } else if (mathDegenerate) {
    finalScore = claudeScore;
  } else {
    finalScore = (claudeScore + mathScore) / 2;
  }

  return { claudeScore, mathScore, finalScore };
}

// ──────────────────────────────────────────────────────────────────────────
// Rank + filter
// ──────────────────────────────────────────────────────────────────────────

/**
 * Apply the full ranking pipeline: seed required tracks, sort by final
 * score, enforce the per-artist cap, truncate by duration (and the
 * `MAX_PLAYLIST_TRACKS` hard cap), then window-shuffle the result.
 *
 * Required tracks are guaranteed to appear even if their score is low
 * or their artist is over the cap. They still consume the duration
 * budget and contribute to subsequent cap checks.
 */
export function rankAndFilter(
  candidates: readonly ScoredTrack[],
  options: RankAndFilterOptions,
): ScoredTrack[] {
  const {
    targetDurationMs,
    perArtistCap,
    shuffleWindowSize,
    requiredTrackIds = [],
    excludeIds,
    initialArtistCounts,
    rng = Math.random,
  } = options;

  // Index by trackId so required-id lookups are O(1).
  const byId = new Map<string, ScoredTrack>();
  for (const c of candidates) byId.set(c.trackId, c);

  // Working state.
  const picked: ScoredTrack[] = [];
  const pickedIds = new Set<string>();
  const artistCounts = new Map<string, number>();
  if (initialArtistCounts) {
    for (const [artistId, count] of initialArtistCounts) {
      artistCounts.set(artistId, count);
    }
  }
  let totalDurationMs = 0;

  // 1. Seed `picked` with required tracks (exempt from cap).
  for (const id of requiredTrackIds) {
    const track = byId.get(id);
    if (!track) continue;
    if (pickedIds.has(track.trackId)) continue;
    picked.push(track);
    pickedIds.add(track.trackId);
    artistCounts.set(
      track.primaryArtistId,
      (artistCounts.get(track.primaryArtistId) ?? 0) + 1,
    );
    totalDurationMs += track.durationMs;
  }

  // 2. Sort non-required candidates by finalScore DESC, trackId ASC tiebreak.
  const sorted = candidates
    .filter((c) => !pickedIds.has(c.trackId))
    .slice()
    .sort((a, b) => {
      if (b.finalScore !== a.finalScore) return b.finalScore - a.finalScore;
      return a.trackId < b.trackId ? -1 : a.trackId > b.trackId ? 1 : 0;
    });

  // 3 + 4. Filter, cap, truncate by duration and MAX_PLAYLIST_TRACKS.
  for (const track of sorted) {
    if (totalDurationMs >= targetDurationMs) break;
    if (picked.length >= MAX_PLAYLIST_TRACKS) break;

    if (excludeIds?.has(track.trackId)) continue;
    const artistCount = artistCounts.get(track.primaryArtistId) ?? 0;
    if (artistCount >= perArtistCap) continue;

    picked.push(track);
    pickedIds.add(track.trackId);
    artistCounts.set(track.primaryArtistId, artistCount + 1);
    totalDurationMs += track.durationMs;
  }

  if (picked.length >= MAX_PLAYLIST_TRACKS && totalDurationMs < targetDurationMs) {
    console.warn(
      `[playlist-scoring] Hit MAX_PLAYLIST_TRACKS (${MAX_PLAYLIST_TRACKS}) before reaching target duration (${targetDurationMs}ms). Consider shortening the target.`,
    );
  }

  // 5. Fisher-Yates shuffle within non-overlapping windows.
  return shuffleWindows(picked, shuffleWindowSize, rng);
}

function shuffleWindows<T>(
  list: readonly T[],
  windowSize: number,
  rng: () => number,
): T[] {
  if (windowSize <= 1 || list.length <= 1) return list.slice();
  const out = list.slice();
  for (let start = 0; start < out.length; start += windowSize) {
    const end = Math.min(start + windowSize, out.length);
    // Fisher-Yates within [start, end).
    for (let i = end - 1; i > start; i -= 1) {
      const j = start + Math.floor(rng() * (i - start + 1));
      const tmp = out[i]!;
      out[i] = out[j]!;
      out[j] = tmp;
    }
  }
  return out;
}
