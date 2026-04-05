/**
 * Playlist tRPC router.
 *
 * For PR E this exposes a single mutation — `playlist.generate` —
 * which validates input, inserts a `GENERATING` placeholder, and fires
 * the `playlist/generate.requested` Inngest event. The Inngest function
 * populates the recipe and flips the row to `PENDING`. Save / discard /
 * regenerate / top-up / list queries ship in later PRs.
 *
 * See: docs/plans/active/playlist-generation-hybrid.md (PR E).
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "@/server/trpc";
import { inngest } from "@/lib/inngest";
import { trackRepository } from "@/repositories/track.repository";
import { playlistRepository } from "@/repositories/playlist.repository";

const USER_INTENT_MAX_LENGTH = 280;
const MIN_SEED_COUNT = 3;
const MAX_SEED_COUNT = 5;
const MIN_TARGET_DURATION_MINUTES = 15;
const MAX_TARGET_DURATION_MINUTES = 240;
const DEFAULT_TARGET_DURATION_MINUTES = 60;

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
});
