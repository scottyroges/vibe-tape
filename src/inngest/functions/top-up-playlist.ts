/**
 * Top up an existing playlist with additional tracks. Reuses the stored
 * recipe, scores the user's current library, drops tracks already in the
 * playlist via `excludeIds`, and appends new matches. Existing tracks and
 * their order are not touched — top-up is purely additive.
 *
 * Top-up budget = `max(targetMs - existingMs, max(targetMs/4, 10min))`.
 * In plain English: add at least the "standard increment" (25% of the
 * original target, with a 10-minute floor), or more if the playlist is
 * far enough below target that the deficit is larger. This scales
 * uniformly (30-min → +10min, 60-min → +15min, 4hr → +60min) and
 * never adds a trivial sliver — a 58-of-60min playlist still gets
 * +15min, not +2min.
 *
 * If the playlist is already `SAVED`, appends the new URIs to the live
 * Spotify playlist via `POST /v1/playlists/{id}/tracks`.
 *
 * See: docs/plans/active/playlist-generation-hybrid.md (PR G).
 */

import { inngest } from "@/lib/inngest";
import { rankAndFilter } from "@/lib/playlist-scoring";
import { playlistRepository } from "@/repositories/playlist.repository";
import { trackRepository } from "@/repositories/track.repository";
import { scoreLibrary } from "@/inngest/helpers/score-library";
import { computePerArtistCap } from "@/inngest/functions/generate-playlist";
import { getValidToken } from "@/lib/spotify-token";
import { addTracksToPlaylist } from "@/lib/spotify";

const SHUFFLE_WINDOW_SIZE = 8;
const TOP_UP_FLOOR_MS = 10 * 60_000;

/**
 * Top-up increment formula. Exported for the test suite so the expected
 * values in `PR G` tests don't duplicate the constant.
 */
export function computeTopUpExtraMs(
  targetDurationMinutes: number,
  existingDurationMs: number,
): number {
  const targetMs = targetDurationMinutes * 60_000;
  const topUpIncrementMs = Math.max(Math.ceil(targetMs / 4), TOP_UP_FLOOR_MS);
  return Math.max(targetMs - existingDurationMs, topUpIncrementMs);
}

export const topUpPlaylist = inngest.createFunction(
  {
    id: "top-up-playlist",
    retries: 3,
    concurrency: [{ key: "event.data.playlistId", limit: 1 }],
    triggers: [{ event: "playlist/top-up.requested" }],
    // Top-up failure restores the **prior** status (PENDING or SAVED)
    // rather than flipping to FAILED. The recipe and the existing
    // track list are untouched by a failed top-up, so the playlist is
    // still fully usable — trapping a SAVED playlist in FAILED would
    // strip the user's Open-in-Spotify / Regenerate / Add-more
    // affordances and leave only Discard, which would silently orphan
    // the live Spotify playlist. Fall back to setFailed only when the
    // event is missing a priorStatus (defensive — the router always
    // provides one).
    onFailure: async ({ event }) => {
      const playlistId = event.data.event.data.playlistId;
      const priorStatus = event.data.event.data.priorStatus;
      if (typeof playlistId !== "string") return;
      if (priorStatus === "PENDING" || priorStatus === "SAVED") {
        await playlistRepository.setStatus(playlistId, priorStatus);
      } else {
        await playlistRepository.setFailed(playlistId, "top-up failed");
      }
    },
  },
  async ({ event, step }) => {
    const playlistId = event.data.playlistId;
    if (typeof playlistId !== "string") {
      throw new Error(
        "playlist/top-up.requested requires a string playlistId",
      );
    }

    // 1. Load the recipe + the existing track rows (we need their
    //    durations to compute the running total and their primary
    //    artists to pre-populate the per-artist cap map).
    const loaded = await step.run("load-playlist", async () => {
      const playlist = await playlistRepository.findByIdWithRecipe(playlistId);
      if (!playlist) throw new Error(`Playlist ${playlistId} not found`);
      if (!playlist.claudeTarget || !playlist.mathTarget) {
        throw new Error(
          `Playlist ${playlistId} is missing its recipe targets`,
        );
      }
      const existingRows =
        playlist.generatedTrackIds.length > 0
          ? await trackRepository.findByIdsWithScoringFields(
              playlist.generatedTrackIds,
            )
          : [];
      return { playlist, existingRows };
    });

    const { playlist, existingRows } = loaded;
    const claudeTarget = playlist.claudeTarget!;
    const mathTarget = playlist.mathTarget!;

    const existingIds = new Set(playlist.generatedTrackIds);
    // `durationMs` lives on `trackSpotifyEnrichment` and is seeded as
    // part of `sync-library`. In practice every track in a generated
    // playlist has a duration by the time top-up runs (generate itself
    // depends on the same enrichment). If enrichment ever regresses,
    // missing durations get treated as 0 here, which makes top-up
    // overestimate the deficit — acceptable, self-healing next sync.
    const existingDurationMs = existingRows.reduce(
      (sum, t) => sum + (t.durationMs ?? 0),
      0,
    );

    // Pre-populate per-artist counts so the cap applies across
    // existing + new. Existing tracks don't count toward the
    // excludeIds path (that filters new candidates out), but they DO
    // need to increment the starting counts so we don't add another
    // Artist X track if the user already has three.
    const initialArtistCounts = new Map<string, number>();
    for (const row of existingRows) {
      initialArtistCounts.set(
        row.primaryArtistId,
        (initialArtistCounts.get(row.primaryArtistId) ?? 0) + 1,
      );
    }

    // 2. Score the full library. We let `rankAndFilter` drop existing
    //    tracks via `excludeIds` rather than pre-filtering in JS —
    //    scoring is pure math on ~1,500 rows, the redundant work is
    //    negligible, and the code is simpler.
    const scored = await step.run("score-library", async () => {
      return scoreLibrary(playlist.userId, {
        claude: claudeTarget,
        math: mathTarget,
      });
    });

    // 3. Compute the top-up budget + rank.
    const extraMs = computeTopUpExtraMs(
      playlist.targetDurationMinutes,
      existingDurationMs,
    );
    const perArtistCap = computePerArtistCap(playlist.targetDurationMinutes);
    const additions = rankAndFilter(scored, {
      targetDurationMs: extraMs,
      perArtistCap,
      shuffleWindowSize: SHUFFLE_WINDOW_SIZE,
      excludeIds: existingIds,
      initialArtistCounts,
    });
    const additionIds = additions.map((s) => s.trackId);

    // 4. Append to the DB row (existing order untouched).
    await step.run("append-tracks", async () => {
      await playlistRepository.appendTracks(playlistId, additionIds);
    });

    // 5. If on Spotify, append the new URIs only (not the full list).
    const priorStatus = event.data.priorStatus;
    if (
      priorStatus === "SAVED" &&
      typeof playlist.spotifyPlaylistId === "string" &&
      additionIds.length > 0
    ) {
      await step.run("append-to-spotify", async () => {
        const token = await getValidToken(playlist.userId);
        if (!token) throw new Error("No Spotify token");
        const tracks = await trackRepository.findByIds(additionIds);
        const bySpotifyId = new Map(tracks.map((t) => [t.id, t.spotifyId]));
        const uris = additionIds
          .map((id) => bySpotifyId.get(id))
          .filter((s): s is string => typeof s === "string")
          .map((s) => `spotify:track:${s}`);
        if (uris.length > 0) {
          await addTracksToPlaylist(
            token.accessToken,
            playlist.spotifyPlaylistId!,
            uris,
          );
        }
      });
    }

    // 6. Restore the prior lifecycle status.
    await step.run("restore-status", async () => {
      await playlistRepository.setStatus(
        playlistId,
        priorStatus === "SAVED" ? "SAVED" : "PENDING",
      );
    });

    return { playlistId, added: additionIds.length };
  },
);
