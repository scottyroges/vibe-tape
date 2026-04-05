/**
 * Shared helper used by generate / regenerate / top-up Inngest functions:
 * load every track in the user's liked library in scoring shape and
 * compute (claudeScore, mathScore, finalScore) against a pair of
 * targets. No ranking, capping, filtering, or DB writes — callers wrap
 * this inside a `step.run` and hand the result to `rankAndFilter`.
 *
 * Extracted so the scoring math can't drift across the three lifecycle
 * operations. See: docs/plans/completed/playlist-generation-hybrid.md (PR E).
 */

import {
  computeFinalScore,
  type ScoredTrack,
} from "@/lib/playlist-scoring";
import type { VibeProfile } from "@/lib/vibe-profile";
import type { CanonicalMood } from "@/lib/prompts/classify-tracks";
import { trackRepository } from "@/repositories/track.repository";

/**
 * Narrow the `Track.vibe*` DB columns (typed as `string | null`) onto
 * the `VibeProfile` shape that `scoreTrack` and `computeMathTarget`
 * expect. Safe because the vibe-derivation pipeline only writes
 * canonical values into these columns — see `deriveVibeProfile`.
 *
 * Exported because the generate / regenerate / top-up Inngest functions
 * also need this shape for seed rows (the Claude prompt + math target
 * both consume `VibeProfile`s). Keeping exactly one implementation
 * prevents drift across the three lifecycle operations.
 */
export function trackRowToVibeProfile(t: {
  vibeMood: string | null;
  vibeEnergy: string | null;
  vibeDanceability: string | null;
  vibeGenres: string[];
  vibeTags: string[];
}): VibeProfile {
  return {
    mood: t.vibeMood as CanonicalMood | null,
    energy: t.vibeEnergy as "low" | "medium" | "high" | null,
    danceability: t.vibeDanceability as "low" | "medium" | "high" | null,
    genres: t.vibeGenres,
    tags: t.vibeTags,
  };
}

export async function scoreLibrary(
  userId: string,
  targets: { claude: VibeProfile; math: VibeProfile },
): Promise<ScoredTrack[]> {
  const library =
    await trackRepository.findAllWithScoringFieldsByUser(userId);

  return library.map((t) => {
    const candidate = trackRowToVibeProfile(t);
    const { claudeScore, mathScore, finalScore } = computeFinalScore(
      candidate,
      targets.claude,
      targets.math,
    );
    return {
      trackId: t.id,
      primaryArtistId: t.primaryArtistId,
      durationMs: t.durationMs ?? 0,
      claudeScore,
      mathScore,
      finalScore,
    };
  });
}
