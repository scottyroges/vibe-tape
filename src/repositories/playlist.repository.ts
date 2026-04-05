import { db } from "@/lib/db";
import { sql } from "kysely";
import { createId } from "@/lib/id";
import type {
  Playlist,
  Track,
  TrackScore,
  TrackWithDisplayFields,
} from "@/domain/types";
import type { VibeProfile } from "@/lib/vibe-profile";
import { trackRepository } from "@/repositories/track.repository";

/**
 * Build a `::jsonb` literal from a JS value. Exists because
 * node-postgres otherwise serializes a bare JS `Array` as a PG array
 * literal (`{…}`), not as JSON — writing an array-of-objects into a
 * jsonb column via Kysely's `.set({ col: array })` blows up with
 * `invalid input syntax for type json`. Stringifying ourselves and
 * casting to `jsonb` sends a single text parameter that Postgres
 * parses as JSON. Plain objects don't need this — node-postgres
 * JSON.stringify's those automatically.
 */
function jsonbLiteral(value: unknown) {
  return sql`${JSON.stringify(value)}::jsonb`;
}

/**
 * Shape returned by `findAllByUserSummary` — list-view summary without
 * resolving tracks. `trackCount` comes from PG `array_length` so we
 * don't pull every `generatedTrackIds` array over the wire.
 */
export type PlaylistSummary = {
  id: string;
  vibeName: string;
  vibeDescription: string | null;
  status: Playlist["status"];
  spotifyPlaylistId: string | null;
  trackCount: number;
  createdAt: Date;
};

/**
 * Normalize a raw DB row into a `Playlist`. Narrow-casts the JSONB
 * `claudeTarget` / `mathTarget` columns to `VibeProfile | null` — the
 * only writers (`completeGeneration` etc.) always pass values that are
 * already typed as `VibeProfile`, so the cast is trusted here and
 * nowhere leaks `unknown` past the repository boundary.
 */
function toDomain(row: {
  id: string;
  userId: string;
  spotifyPlaylistId: string | null;
  vibeName: string;
  vibeDescription: string | null;
  seedSongIds: string[];
  status: Playlist["status"];
  generatedTrackIds: string[];
  trackScores: unknown | null;
  targetDurationMinutes: number;
  userIntent: string | null;
  claudeTarget: unknown | null;
  mathTarget: unknown | null;
  errorMessage: string | null;
  artImageUrl: string | null;
  lastSyncedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): Playlist {
  return {
    ...row,
    claudeTarget: row.claudeTarget as VibeProfile | null,
    mathTarget: row.mathTarget as VibeProfile | null,
    trackScores: row.trackScores as TrackScore[] | null,
  };
}

export const playlistRepository = {
  async findById(id: string): Promise<Playlist | null> {
    const row = await db
      .selectFrom("playlist")
      .where("id", "=", id)
      .selectAll()
      .executeTakeFirst();
    return row ? toDomain(row) : null;
  },

  async findByUserId(userId: string): Promise<Playlist[]> {
    const rows = await db
      .selectFrom("playlist")
      .where("userId", "=", userId)
      .selectAll()
      .orderBy("createdAt", "desc")
      .execute();
    return rows.map(toDomain);
  },

  /**
   * Inserts a placeholder row before firing the Inngest event. Status
   * starts at `GENERATING`; `generatedTrackIds` is empty; `vibeName` is
   * a stub that the Inngest function overwrites once Claude returns.
   */
  async createPlaceholder(
    userId: string,
    input: {
      seedTrackIds: string[];
      targetDurationMinutes: number;
      userIntent: string | null;
    }
  ): Promise<string> {
    const id = createId();
    await db
      .insertInto("playlist")
      .values({
        id,
        userId,
        vibeName: "Generating...",
        seedSongIds: input.seedTrackIds,
        status: "GENERATING",
        generatedTrackIds: [],
        targetDurationMinutes: input.targetDurationMinutes,
        userIntent: input.userIntent,
        updatedAt: new Date(),
      })
      .execute();
    return id;
  },

  /**
   * Called at the end of `generate-playlist` once Claude + scoring have
   * run. Persists the full recipe and flips status to `PENDING`.
   */
  async completeGeneration(
    playlistId: string,
    data: {
      vibeName: string;
      vibeDescription: string | null;
      claudeTarget: VibeProfile;
      mathTarget: VibeProfile;
      generatedTrackIds: string[];
      trackScores: TrackScore[];
    }
  ): Promise<void> {
    await db
      .updateTable("playlist")
      .set({
        vibeName: data.vibeName,
        vibeDescription: data.vibeDescription,
        claudeTarget: data.claudeTarget as unknown as object,
        mathTarget: data.mathTarget as unknown as object,
        generatedTrackIds: data.generatedTrackIds,
        // node-postgres treats a bare JS Array as a PG array literal
        // (`{…}`), not as JSON. That breaks jsonb inserts with errors
        // like `invalid input syntax for type json`. Wrap in a raw
        // `sql`${stringified}::jsonb`` fragment so the driver sends a
        // single text parameter that jsonb can parse. `claudeTarget` /
        // `mathTarget` are plain objects — node-postgres JSON.stringify's
        // those for us, so they don't need the same treatment.
        trackScores: jsonbLiteral(data.trackScores),
        status: "PENDING",
        updatedAt: new Date(),
      })
      .where("id", "=", playlistId)
      .execute();
  },

  /**
   * Full replacement of `generatedTrackIds` + `trackScores`. Used by
   * `regenerate-playlist`. Both fields are replaced atomically so the
   * scores stay aligned with the tracks.
   */
  async updateTracks(
    playlistId: string,
    trackIds: string[],
    trackScores: TrackScore[]
  ): Promise<void> {
    await db
      .updateTable("playlist")
      .set({
        generatedTrackIds: trackIds,
        // See `completeGeneration` for the reasoning on the sql cast.
        trackScores: jsonbLiteral(trackScores),
        updatedAt: new Date(),
      })
      .where("id", "=", playlistId)
      .execute();
  },

  /**
   * Appends new IDs onto the end of `generatedTrackIds` and the matching
   * score triples onto `trackScores`. Used by `top-up-playlist`. If the
   * existing row has `trackScores IS NULL` (legacy row from before the
   * column existed), the append starts with just the new scores — the
   * old tracks will render without scores but nothing crashes.
   */
  async appendTracks(
    playlistId: string,
    trackIds: string[],
    trackScores: TrackScore[]
  ): Promise<void> {
    if (trackIds.length === 0) return;
    await db
      .updateTable("playlist")
      .set({
        generatedTrackIds: sql`array_cat(generated_track_ids, ${trackIds}::text[])`,
        // `coalesce(track_scores, '[]'::jsonb) || $newScores::jsonb` —
        // append the new score triples to whatever is currently stored,
        // treating NULL as an empty array so legacy rows don't explode.
        // `jsonbLiteral` is the same helper `completeGeneration` uses;
        // see its docstring for the node-postgres JSON-array gotcha.
        trackScores: sql`coalesce(track_scores, '[]'::jsonb) || ${jsonbLiteral(
          trackScores,
        )}`,
        updatedAt: new Date(),
      })
      .where("id", "=", playlistId)
      .execute();
  },

  /**
   * Atomically sets `spotifyPlaylistId` and flips status to `SAVED`.
   * This is the ONLY method that touches either field — the
   * `status ↔ spotifyPlaylistId` invariant is enforced by this being
   * the single writer.
   */
  async markSaved(
    playlistId: string,
    spotifyPlaylistId: string
  ): Promise<void> {
    await db
      .updateTable("playlist")
      .set({
        spotifyPlaylistId,
        status: "SAVED",
        updatedAt: new Date(),
      })
      .where("id", "=", playlistId)
      .execute();
  },

  /**
   * Flips status without touching `spotifyPlaylistId`. Used by the
   * regenerate/top-up lifecycle to drive the transient
   * `PENDING/SAVED → GENERATING → PENDING/SAVED` transitions that power
   * the detail-page spinner.
   *
   * **Invariant note.** `markSaved` is still the sole writer of the
   * `status ↔ spotifyPlaylistId` pair — this method only flips `status`
   * and relies on callers (regenerate/top-up) to only pass `SAVED`
   * when the row already has a `spotifyPlaylistId` set from a prior
   * save. The only legal inputs are the three lifecycle statuses
   * below; `FAILED` goes through `setFailed` (which also stores the
   * error message).
   */
  async setStatus(
    playlistId: string,
    status: "GENERATING" | "PENDING" | "SAVED"
  ): Promise<void> {
    await db
      .updateTable("playlist")
      .set({ status, updatedAt: new Date() })
      .where("id", "=", playlistId)
      .execute();
  },

  /**
   * Flips status to `FAILED` and stores an error message. Called by
   * `onFailure` handlers on the Inngest functions.
   */
  async setFailed(
    playlistId: string,
    errorMessage: string
  ): Promise<void> {
    await db
      .updateTable("playlist")
      .set({
        status: "FAILED",
        errorMessage,
        updatedAt: new Date(),
      })
      .where("id", "=", playlistId)
      .execute();
  },

  async delete(playlistId: string): Promise<void> {
    await db
      .deleteFrom("playlist")
      .where("id", "=", playlistId)
      .execute();
  },

  /**
   * Returns the playlist row including the recipe fields
   * (claudeTarget, mathTarget). Used by regenerate/top-up to re-score
   * the library against the original vibe.
   */
  async findByIdWithRecipe(playlistId: string): Promise<Playlist | null> {
    const row = await db
      .selectFrom("playlist")
      .where("id", "=", playlistId)
      .selectAll()
      .executeTakeFirst();
    return row ? toDomain(row) : null;
  },

  /**
   * Returns the playlist plus the resolved `Track` rows (with primary
   * artist name) for `generatedTrackIds` in order. Used by the
   * `/playlist/{id}` page.
   */
  async findByIdWithTracks(
    playlistId: string
  ): Promise<
    | (Playlist & { tracks: TrackWithDisplayFields[] })
    | null
  > {
    const playlist = await this.findById(playlistId);
    if (!playlist) return null;

    const tracks = await trackRepository.findByIdsWithDisplayFields(
      playlist.generatedTrackIds
    );
    // Re-order to match generatedTrackIds (the SQL query is unordered).
    const byId = new Map(tracks.map((t: Track) => [t.id, t]));
    const ordered = playlist.generatedTrackIds
      .map((id) => byId.get(id))
      .filter((t): t is TrackWithDisplayFields => t !== undefined);

    return { ...playlist, tracks: ordered };
  },

  /**
   * Dashboard list view. Returns one row per playlist with the
   * lightweight fields needed by the listing UI. Track count comes
   * from `array_length(generated_track_ids, 1)` to avoid pulling the
   * full array over the wire.
   */
  async findAllByUserSummary(userId: string): Promise<PlaylistSummary[]> {
    const rows = await db
      .selectFrom("playlist")
      .where("userId", "=", userId)
      .select([
        "id",
        "vibeName",
        "vibeDescription",
        "status",
        "spotifyPlaylistId",
        "createdAt",
      ])
      .select(
        sql<number>`coalesce(array_length(generated_track_ids, 1), 0)`.as(
          "trackCount"
        )
      )
      .orderBy("createdAt", "desc")
      .execute();

    return rows.map((r) => ({
      id: r.id,
      vibeName: r.vibeName,
      vibeDescription: r.vibeDescription,
      status: r.status,
      spotifyPlaylistId: r.spotifyPlaylistId,
      trackCount: Number(r.trackCount),
      createdAt: r.createdAt,
    }));
  },
};
