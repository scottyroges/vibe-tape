/**
 * Regenerate an existing playlist (PENDING or SAVED) against its stored
 * recipe. Reuses `claudeTarget` / `mathTarget` / `seedSongIds` /
 * `targetDurationMinutes` / `vibeName` / `vibeDescription` — no new
 * Claude call. Re-scores the user's *current* library, re-ranks, and
 * replaces `generatedTrackIds`.
 *
 * If the playlist is already `SAVED`, the live Spotify playlist's
 * track list is replaced via `PUT /v1/playlists/{id}/tracks`.
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
import { replacePlaylistTracks } from "@/lib/spotify";

const SHUFFLE_WINDOW_SIZE = 8;

export const regeneratePlaylist = inngest.createFunction(
  {
    id: "regenerate-playlist",
    retries: 3,
    concurrency: [{ key: "event.data.playlistId", limit: 1 }],
    triggers: [{ event: "playlist/regenerate.requested" }],
    // Regenerate failure restores the **prior** status (PENDING or
    // SAVED) rather than flipping to FAILED. The recipe is untouched
    // by a failed regenerate, and for SAVED playlists the live
    // Spotify playlist still exists — trapping the row in FAILED
    // would strip Open-in-Spotify / Regenerate / Add-more and leave
    // only Discard, which would orphan the Spotify playlist. Fall
    // back to setFailed only when priorStatus is missing (defensive).
    onFailure: async ({ event }) => {
      const playlistId = event.data.event.data.playlistId;
      const priorStatus = event.data.event.data.priorStatus;
      if (typeof playlistId !== "string") return;
      if (priorStatus === "PENDING" || priorStatus === "SAVED") {
        await playlistRepository.setStatus(playlistId, priorStatus);
      } else {
        await playlistRepository.setFailed(playlistId, "regeneration failed");
      }
    },
  },
  async ({ event, step }) => {
    const playlistId = event.data.playlistId;
    if (typeof playlistId !== "string") {
      throw new Error(
        "playlist/regenerate.requested requires a string playlistId",
      );
    }

    // 1. Load the recipe. The tRPC mutation flipped status to GENERATING
    //    before firing the event; we restore it to its prior status
    //    (PENDING or SAVED) at the end via `restoreStatus`.
    const playlist = await step.run("load-playlist", async () => {
      const row = await playlistRepository.findByIdWithRecipe(playlistId);
      if (!row) throw new Error(`Playlist ${playlistId} not found`);
      if (!row.claudeTarget || !row.mathTarget) {
        throw new Error(
          `Playlist ${playlistId} is missing its recipe targets`,
        );
      }
      return row;
    });

    const claudeTarget = playlist.claudeTarget!;
    const mathTarget = playlist.mathTarget!;

    // 2. Score the user's current library against the stored targets.
    const scored = await step.run("score-library", async () => {
      return scoreLibrary(playlist.userId, {
        claude: claudeTarget,
        math: mathTarget,
      });
    });

    // 3. Rank/cap/truncate. Seeds stay hard-guaranteed on every re-roll,
    //    matching the original generation's contract.
    const perArtistCap = computePerArtistCap(playlist.targetDurationMinutes);
    const final = rankAndFilter(scored, {
      targetDurationMs: playlist.targetDurationMinutes * 60_000,
      perArtistCap,
      shuffleWindowSize: SHUFFLE_WINDOW_SIZE,
      requiredTrackIds: playlist.seedSongIds,
    });
    const finalTrackIds = final.map((s) => s.trackId);

    // 4. Persist new track list. `updateTracks` only touches
    //    `generatedTrackIds` — recipe fields stay intact.
    await step.run("save-playlist", async () => {
      await playlistRepository.updateTracks(playlistId, finalTrackIds);
    });

    // 5. If already on Spotify, replace the live track list.
    const priorStatus = event.data.priorStatus;
    const wasSaved =
      priorStatus === "SAVED" && typeof playlist.spotifyPlaylistId === "string";
    if (wasSaved) {
      await step.run("sync-spotify", async () => {
        const token = await getValidToken(playlist.userId);
        if (!token) throw new Error("No Spotify token");
        const tracks = await trackRepository.findByIds(finalTrackIds);
        // `findByIds` is unordered — re-key by id and map back to the
        // ranked order so Spotify sees the same sequence we stored.
        const bySpotifyId = new Map(tracks.map((t) => [t.id, t.spotifyId]));
        const uris = finalTrackIds
          .map((id) => bySpotifyId.get(id))
          .filter((s): s is string => typeof s === "string")
          .map((s) => `spotify:track:${s}`);
        await replacePlaylistTracks(
          token.accessToken,
          playlist.spotifyPlaylistId!,
          uris,
        );
      });
    }

    // 6. Restore the prior lifecycle status (PENDING or SAVED). The
    //    tRPC mutation flipped to GENERATING to drive the detail-page
    //    spinner; now we restore whichever status the playlist had
    //    before this regenerate started.
    await step.run("restore-status", async () => {
      await playlistRepository.setStatus(
        playlistId,
        priorStatus === "SAVED" ? "SAVED" : "PENDING",
      );
    });

    return { playlistId, trackCount: finalTrackIds.length };
  },
);
