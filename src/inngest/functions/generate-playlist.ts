/**
 * First-run playlist generation.
 *
 * Triggered by `playlist.generate` tRPC mutation via the
 * `playlist/generate.requested` event. The tRPC mutation inserts a
 * placeholder row (`status: GENERATING`) before firing the event; this
 * function populates the recipe (vibeName, vibeDescription, targets,
 * generatedTrackIds) and flips the row to `PENDING`.
 *
 * No Spotify push happens here — the playlist sits at `PENDING` until
 * the user explicitly clicks Save in the UI.
 *
 * See: docs/plans/active/playlist-generation-hybrid.md (PR E).
 */

import { inngest } from "@/lib/inngest";
import {
  computeMathTarget,
  rankAndFilter,
} from "@/lib/playlist-scoring";
import {
  buildPlaylistCriteriaPrompt,
  parsePlaylistCriteriaResponse,
  type PlaylistCriteriaSeed,
} from "@/lib/prompts/generate-playlist-criteria";
import { generatePlaylistCriteria } from "@/lib/claude";
import { trackRepository } from "@/repositories/track.repository";
import { playlistRepository } from "@/repositories/playlist.repository";
import {
  scoreLibrary,
  trackRowToVibeProfile,
} from "@/inngest/helpers/score-library";

/**
 * Default target when the tRPC input omits `targetDurationMinutes`.
 */
const DEFAULT_TARGET_DURATION_MINUTES = 60;

/**
 * Window size for the post-rank shuffle. Keeps coarse rank order while
 * mixing adjacent tracks so repeated generates on the same seeds don't
 * produce byte-identical playlists. See the plan for the rationale.
 */
const SHUFFLE_WINDOW_SIZE = 8;

/**
 * Dynamic per-artist cap: `max(3, ceil(estimatedTrackCount / 6))` where
 * `estimatedTrackCount ≈ targetDurationMinutes * 60 / 210` (210s per
 * track is the rough average for a pop/rock library). Keeps the cap at
 * roughly 15–20% of the playlist regardless of length.
 */
export function computePerArtistCap(targetDurationMinutes: number): number {
  const estimatedTrackCount = Math.ceil(
    (targetDurationMinutes * 60) / 210,
  );
  return Math.max(3, Math.ceil(estimatedTrackCount / 6));
}

export const generatePlaylist = inngest.createFunction(
  {
    id: "generate-playlist",
    retries: 3,
    concurrency: [{ key: "event.data.playlistId", limit: 1 }],
    triggers: [{ event: "playlist/generate.requested" }],
    onFailure: async ({ event }) => {
      const playlistId = event.data.event.data.playlistId;
      if (typeof playlistId === "string") {
        await playlistRepository.setFailed(playlistId, "generation failed");
      }
    },
  },
  async ({ event, step }) => {
    const userId = event.data.userId;
    const playlistId = event.data.playlistId;
    const seedTrackIds = event.data.seedTrackIds;
    const targetDurationMinutes =
      typeof event.data.targetDurationMinutes === "number"
        ? event.data.targetDurationMinutes
        : DEFAULT_TARGET_DURATION_MINUTES;
    const userIntent =
      typeof event.data.userIntent === "string"
        ? event.data.userIntent
        : undefined;

    if (typeof userId !== "string" || typeof playlistId !== "string") {
      throw new Error(
        "playlist/generate.requested requires string userId + playlistId",
      );
    }
    if (
      !Array.isArray(seedTrackIds) ||
      seedTrackIds.length === 0 ||
      !seedTrackIds.every((id): id is string => typeof id === "string")
    ) {
      throw new Error(
        "playlist/generate.requested requires a non-empty string seedTrackIds array",
      );
    }

    // 1. Load seeds. We need two shapes: scoring fields (for the math
    //    target + primary artist id) and an artist-name string for the
    //    Claude prompt display block. Fetching both in a single step so
    //    any DB hiccup only causes one retry boundary. If the seed rows
    //    have vanished between the tRPC call and this step, throw inside
    //    the step so the error shows up on the right Inngest boundary.
    const seedData = await step.run("load-seeds", async () => {
      const [scoring, display] = await Promise.all([
        trackRepository.findByIdsWithScoringFields(seedTrackIds),
        trackRepository.findByIdsWithDisplayFields(seedTrackIds),
      ]);
      if (scoring.length === 0) {
        throw new Error(`No seed tracks found for playlist ${playlistId}`);
      }
      const displayById = new Map(
        display.map((t) => [t.id, t.artistsDisplay]),
      );
      return scoring.map((t) => ({
        id: t.id,
        name: t.name,
        artistsDisplay: displayById.get(t.id) ?? "",
        primaryArtistId: t.primaryArtistId,
        durationMs: t.durationMs,
        vibeMood: t.vibeMood,
        vibeEnergy: t.vibeEnergy,
        vibeDanceability: t.vibeDanceability,
        vibeGenres: t.vibeGenres,
        vibeTags: t.vibeTags,
      }));
    });

    // 2. Math target (pure centroid of seeds — userIntent doesn't apply here).
    const mathTarget = await step.run("compute-math-target", async () => {
      return computeMathTarget(seedData.map(trackRowToVibeProfile));
    });

    // 3. Claude target + name/description. userIntent enriches the prompt
    //    when present; empty/whitespace gets normalized to undefined by
    //    `buildPlaylistCriteriaPrompt` internally.
    const criteria = await step.run("claude-target", async () => {
      const seedsForPrompt: PlaylistCriteriaSeed[] = seedData.map((s) => ({
        name: s.name,
        artist: s.artistsDisplay,
        ...trackRowToVibeProfile(s),
      }));
      const { system, user } = buildPlaylistCriteriaPrompt(
        seedsForPrompt,
        userIntent,
      );
      const { raw } = await generatePlaylistCriteria(system, user);
      const parsed = parsePlaylistCriteriaResponse(raw);
      if (!parsed) {
        throw new Error(
          "Claude returned an invalid playlist-criteria response",
        );
      }
      return parsed;
    });

    // 4. Score the user's library against both targets via the shared helper.
    const scored = await step.run("score-library", async () => {
      return scoreLibrary(userId, {
        claude: criteria.target,
        math: mathTarget,
      });
    });

    // 5. Rank, cap, truncate by duration, shuffle. Seeds are required —
    //    hard-guaranteed to appear in the output even if their score
    //    would otherwise drop them.
    const perArtistCap = computePerArtistCap(targetDurationMinutes);
    const final = rankAndFilter(scored, {
      targetDurationMs: targetDurationMinutes * 60_000,
      perArtistCap,
      shuffleWindowSize: SHUFFLE_WINDOW_SIZE,
      requiredTrackIds: seedTrackIds,
    });

    // 6. Persist + flip status: GENERATING → PENDING.
    await step.run("save-playlist", async () => {
      await playlistRepository.completeGeneration(playlistId, {
        vibeName: criteria.vibeName,
        vibeDescription: criteria.vibeDescription,
        claudeTarget: criteria.target,
        mathTarget,
        generatedTrackIds: final.map((s) => s.trackId),
      });
    });

    return { playlistId, trackCount: final.length };
  },
);
