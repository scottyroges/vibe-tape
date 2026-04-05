/**
 * Playlist tRPC router.
 *
 * Covers the generate (PR E) + save/discard/detail-page (PR F) surface.
 * `save` runs inline inside the mutation — no Inngest step — because
 * it's a one-shot Spotify write and the user is waiting on the response.
 * Regenerate / top-up / list queries ship in later PRs.
 *
 * See: docs/plans/completed/playlist-generation-hybrid.md (PRs E + F).
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "@/server/trpc";
import { inngest } from "@/lib/inngest";
import { trackRepository } from "@/repositories/track.repository";
import { playlistRepository } from "@/repositories/playlist.repository";
import { getValidToken } from "@/lib/spotify-token";
import {
  createPlaylist,
  addTracksToPlaylist,
} from "@/lib/spotify";

const USER_INTENT_MAX_LENGTH = 280;
const MIN_SEED_COUNT = 3;
const MAX_SEED_COUNT = 5;
const MIN_TARGET_DURATION_MINUTES = 15;
const MAX_TARGET_DURATION_MINUTES = 360;
const DEFAULT_TARGET_DURATION_MINUTES = 60;

/**
 * Read-layer TTL override. If `onFailure` itself fails (DB down during
 * the transition etc.) a playlist row can be stuck at `GENERATING`
 * forever. `getById` reports such rows as `FAILED` on the wire without
 * writing to the DB — the next regenerate/discard sweeps the stale row
 * via the normal paths. Five minutes is generous; realistic generation
 * takes 3–6 seconds. See the plan section "Stuck-GENERATING TTL override".
 */
const STUCK_GENERATING_MS = 5 * 60_000;

/**
 * Seed count is enforced by zod (3–5) and by the Claude prompt design.
 * `userIntent` normalizes empty/whitespace strings to `undefined` *before*
 * the length check so the bound only applies to non-empty input — empty
 * strings get persisted as `null` on the row, not as `""`.
 */
const generateInput = z.object({
  seedTrackIds: z
    .array(z.string().min(1))
    .min(MIN_SEED_COUNT)
    .max(MAX_SEED_COUNT),
  targetDurationMinutes: z
    .number()
    .int()
    .min(MIN_TARGET_DURATION_MINUTES)
    .max(MAX_TARGET_DURATION_MINUTES)
    .optional(),
  userIntent: z
    .string()
    .max(USER_INTENT_MAX_LENGTH)
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined;
      const trimmed = v.trim();
      return trimmed.length === 0 ? undefined : trimmed;
    }),
});

export const playlistRouter = router({
  generate: protectedProcedure
    .input(generateInput)
    .mutation(async ({ ctx, input }) => {
      const targetDurationMinutes =
        input.targetDurationMinutes ?? DEFAULT_TARGET_DURATION_MINUTES;

      // Validate seed ownership: every seed must be in the caller's
      // liked library. Prevents a client from seeding a generation with
      // another user's track IDs.
      const owned = await trackRepository.findOwnedTrackIds(
        ctx.userId,
        input.seedTrackIds,
      );
      const missing = input.seedTrackIds.filter((id) => !owned.has(id));
      if (missing.length > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Seed tracks not owned by user: ${missing.join(", ")}`,
        });
      }

      const playlistId = await playlistRepository.createPlaceholder(
        ctx.userId,
        {
          seedTrackIds: input.seedTrackIds,
          targetDurationMinutes,
          userIntent: input.userIntent ?? null,
        },
      );

      await inngest.send({
        name: "playlist/generate.requested",
        data: {
          userId: ctx.userId,
          playlistId,
          seedTrackIds: input.seedTrackIds,
          targetDurationMinutes,
          userIntent: input.userIntent ?? null,
        },
      });

      return { playlistId };
    }),

  /**
   * Load a playlist for the detail page. Returns the recipe, the
   * resolved generated tracks (in `generatedTrackIds` order), and the
   * resolved seed tracks (in `seedSongIds` order) so the page can render
   * both lists without a second round trip.
   *
   * Applies the stuck-GENERATING TTL override on the wire: a row older
   * than `STUCK_GENERATING_MS` still sitting at `GENERATING` gets
   * reported as `FAILED` without a DB write. See the constant's docstring.
   */
  getById: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const playlist = await playlistRepository.findById(input.id);
      if (!playlist || playlist.userId !== ctx.userId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      // Fetch display fields for the union of generated + seed tracks in
      // a single query. Seeds frequently also appear as generated tracks
      // (they're passed as `requiredTrackIds` at generation time), so a
      // separate query per list would double-fetch those rows.
      const trackIdUnion = Array.from(
        new Set([...playlist.generatedTrackIds, ...playlist.seedSongIds]),
      );
      const resolved = await trackRepository.findByIdsWithDisplayFields(
        trackIdUnion,
      );
      const byId = new Map(resolved.map((t) => [t.id, t]));

      // Index the persisted score triples by trackId so we can attach
      // them to the resolved track rows. Legacy rows without a
      // `trackScores` column (generated before the field existed) fall
      // through with no scores — the UI shows the rows plain.
      const scoresByTrackId = new Map(
        (playlist.trackScores ?? []).map((s) => [s.trackId, s]),
      );

      // Re-order to match each source array — the query is unordered —
      // and attach the score triple from the persisted array. Seeds
      // carry their own score triple only if they also appear in
      // `generatedTrackIds` (seeds are passed as `requiredTrackIds` at
      // generation time, so in practice they always do).
      const orderedTracks = playlist.generatedTrackIds
        .map((id) => {
          const track = byId.get(id);
          if (!track) return undefined;
          const score = scoresByTrackId.get(id);
          return {
            ...track,
            claudeScore: score?.claude ?? null,
            mathScore: score?.math ?? null,
            finalScore: score?.final ?? null,
          };
        })
        .filter(
          (t): t is (typeof resolved)[number] & {
            claudeScore: number | null;
            mathScore: number | null;
            finalScore: number | null;
          } => t !== undefined,
        );
      const orderedSeeds = playlist.seedSongIds
        .map((id) => byId.get(id))
        .filter((t): t is (typeof resolved)[number] => t !== undefined);

      // Stuck-GENERATING TTL override (read-only — no DB write).
      const isStuck =
        playlist.status === "GENERATING" &&
        playlist.createdAt.getTime() < Date.now() - STUCK_GENERATING_MS;
      const effectiveStatus = isStuck ? ("FAILED" as const) : playlist.status;
      const effectiveErrorMessage = isStuck
        ? (playlist.errorMessage ?? "Generation timed out")
        : playlist.errorMessage;

      return {
        ...playlist,
        status: effectiveStatus,
        errorMessage: effectiveErrorMessage,
        tracks: orderedTracks,
        seeds: orderedSeeds,
      };
    }),

  /**
   * Push a `PENDING` playlist to Spotify. Runs inline — no Inngest step —
   * because it's a single, one-shot write the user is waiting on.
   *
   * Partial-failure tradeoff (accepted, see plan): if `createPlaylist`
   * succeeds but `addTracksToPlaylist` throws, the DB row stays at
   * `PENDING` and the error propagates to the caller. On retry the
   * mutation creates a *second* Spotify playlist; the first becomes an
   * empty orphan. Fine at personal-use scale.
   *
   * The `status ↔ spotifyPlaylistId` invariant is enforced by
   * `playlistRepository.markSaved` being the sole writer of either
   * field — we don't touch the row until both Spotify calls succeed.
   */
  save: protectedProcedure
    .input(z.object({ playlistId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const playlist = await playlistRepository.findByIdWithTracks(
        input.playlistId,
      );
      if (!playlist || playlist.userId !== ctx.userId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      // Optimistic status check — not an atomic lock. Two concurrent
      // save calls on the same playlist can both pass this gate and
      // create two Spotify playlists. That's consistent with the
      // accepted orphan tradeoff documented above; don't "fix" it by
      // adding a DB lock unless the orphan assumption changes.
      if (playlist.status !== "PENDING") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot save playlist in status ${playlist.status}; expected PENDING`,
        });
      }

      const token = await getValidToken(ctx.userId);
      if (!token) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Spotify re-authentication required",
        });
      }

      const uris = playlist.tracks.map(
        (t) => `spotify:track:${t.spotifyId}`,
      );

      const spotifyPlaylistId = await createPlaylist(token.accessToken, {
        name: playlist.vibeName,
        description: playlist.vibeDescription ?? "",
        public: false,
      });

      // If this throws, the orphan Spotify playlist stays on the user's
      // account and the DB row stays at `PENDING`. See the router-level
      // comment above for the rationale.
      await addTracksToPlaylist(
        token.accessToken,
        spotifyPlaylistId,
        uris,
      );

      await playlistRepository.markSaved(input.playlistId, spotifyPlaylistId);

      return { spotifyPlaylistId };
    }),

  /**
   * Regenerate an existing `PENDING` or `SAVED` playlist against its
   * stored recipe. Flips the row to `GENERATING` so the detail page
   * shows the spinner, then fires `playlist/regenerate.requested`; the
   * Inngest function re-scores the library, replaces `generatedTrackIds`,
   * syncs Spotify if the playlist was `SAVED`, and restores the prior
   * status. Recipe fields (vibeName, targets, seeds, targetDuration,
   * userIntent) are not touched.
   */
  regenerate: protectedProcedure
    .input(z.object({ playlistId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const playlist = await playlistRepository.findById(input.playlistId);
      if (!playlist || playlist.userId !== ctx.userId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      if (playlist.status !== "PENDING" && playlist.status !== "SAVED") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot regenerate playlist in status ${playlist.status}; expected PENDING or SAVED`,
        });
      }

      const priorStatus = playlist.status;
      await playlistRepository.setStatus(input.playlistId, "GENERATING");

      await inngest.send({
        name: "playlist/regenerate.requested",
        data: {
          userId: ctx.userId,
          playlistId: input.playlistId,
          priorStatus,
        },
      });

      return { playlistId: input.playlistId };
    }),

  /**
   * Top up an existing `PENDING` or `SAVED` playlist with additional
   * tracks. Flips the row to `GENERATING` (same spinner UX as regenerate),
   * then fires `playlist/top-up.requested`; the Inngest function appends
   * new matches, appends to Spotify if the playlist was `SAVED`, and
   * restores the prior status. Existing tracks and their order are
   * preserved.
   */
  topUp: protectedProcedure
    .input(z.object({ playlistId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const playlist = await playlistRepository.findById(input.playlistId);
      if (!playlist || playlist.userId !== ctx.userId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      if (playlist.status !== "PENDING" && playlist.status !== "SAVED") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot top up playlist in status ${playlist.status}; expected PENDING or SAVED`,
        });
      }

      const priorStatus = playlist.status;
      await playlistRepository.setStatus(input.playlistId, "GENERATING");

      await inngest.send({
        name: "playlist/top-up.requested",
        data: {
          userId: ctx.userId,
          playlistId: input.playlistId,
          priorStatus,
        },
      });

      return { playlistId: input.playlistId };
    }),

  /**
   * Dashboard list view. Returns summary rows for the current user's
   * playlists, newest first. No track resolution — the card only needs
   * name, description, status, count, date, and spotifyPlaylistId (for
   * the Open in Spotify quick action).
   */
  listByUser: protectedProcedure.query(async ({ ctx }) => {
    return playlistRepository.findAllByUserSummary(ctx.userId);
  }),

  /**
   * Delete a non-`SAVED` playlist row. `SAVED` playlists are kept
   * because they've been pushed to Spotify — deleting them is a
   * separate flow if we ever build one.
   */
  discard: protectedProcedure
    .input(z.object({ playlistId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const playlist = await playlistRepository.findById(input.playlistId);
      if (!playlist || playlist.userId !== ctx.userId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      if (playlist.status === "SAVED") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot discard a saved playlist",
        });
      }

      await playlistRepository.delete(input.playlistId);
      return { ok: true as const };
    }),
});
