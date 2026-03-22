import { db } from "@/lib/db";
import { sql } from "kysely";
import { createId } from "@/lib/id";
import type { Track, TrackWithLikedAt } from "@/domain/types";
import type { SpotifyLikedSong } from "@/lib/spotify";

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

export const trackRepository = {
  async findByUserId(userId: string): Promise<TrackWithLikedAt[]> {
    const rows = await db
      .selectFrom("track")
      .innerJoin("likedSong", "likedSong.trackId", "track.id")
      .innerJoin("trackArtist", "trackArtist.trackId", "track.id")
      .innerJoin("artist", "artist.id", "trackArtist.artistId")
      .where("likedSong.userId", "=", userId)
      .selectAll("track")
      .select("likedSong.likedAt")
      .select(
        sql<string>`string_agg(artist.name, ', ' order by track_artist.position)`.as(
          "artist"
        )
      )
      .groupBy(["track.id", "likedSong.likedAt"])
      .orderBy("likedSong.likedAt", "desc")
      .execute();

    return rows as TrackWithLikedAt[];
  },

  async findByIds(ids: string[]): Promise<Track[]> {
    if (ids.length === 0) return [];
    return db
      .selectFrom("track")
      .where("id", "in", ids)
      .selectAll()
      .execute();
  },

  async findStale(version: number, limit: number): Promise<Track[]> {
    return db
      .selectFrom("track")
      .where("enrichmentVersion", "<", version)
      .selectAll()
      .limit(limit)
      .execute();
  },

  async updateDerivedEra(
    updates: { id: string; derivedEra: string }[]
  ): Promise<void> {
    if (updates.length === 0) return;
    const now = new Date();
    for (const { id, derivedEra } of updates) {
      await db
        .updateTable("track")
        .set({ derivedEra, updatedAt: now })
        .where("id", "=", id)
        .execute();
    }
  },

  async findStaleWithArtists(
    version: number,
    limit: number
  ): Promise<(Track & { artist: string })[]> {
    const rows = await db
      .selectFrom("track")
      .innerJoin("trackArtist", "trackArtist.trackId", "track.id")
      .innerJoin("artist", "artist.id", "trackArtist.artistId")
      .where("track.enrichmentVersion", "<", version)
      .selectAll("track")
      .select(
        sql<string>`string_agg(artist.name, ', ' order by track_artist.position)`.as(
          "artist"
        )
      )
      .groupBy("track.id")
      .limit(limit)
      .execute();

    return rows as (Track & { artist: string })[];
  },

  async findStaleWithPrimaryArtist(
    version: number,
    limit: number
  ): Promise<(Track & { artist: string })[]> {
    const rows = await db
      .selectFrom("track")
      .innerJoin("trackArtist", "trackArtist.trackId", "track.id")
      .innerJoin("artist", "artist.id", "trackArtist.artistId")
      .where("track.enrichmentVersion", "<", version)
      .where("trackArtist.position", "=", 0)
      .selectAll("track")
      .select("artist.name as artist")
      .limit(limit)
      .execute();

    return rows as (Track & { artist: string })[];
  },

  async updateLastfmTags(
    updates: { id: string; lastfmTags: string[] }[]
  ): Promise<void> {
    if (updates.length === 0) return;
    await db.transaction().execute(async (trx) => {
      const now = new Date();
      for (const { id, lastfmTags } of updates) {
        await trx
          .updateTable("track")
          .set({ lastfmTags, updatedAt: now })
          .where("id", "=", id)
          .execute();
      }
    });
  },

  async updateClaudeClassification(
    updates: {
      id: string;
      claudeMood: string;
      claudeEnergy: string;
      claudeDanceability: string;
      claudeVibeTags: string[];
    }[]
  ): Promise<void> {
    if (updates.length === 0) return;
    await db.transaction().execute(async (trx) => {
      const now = new Date();
      for (const { id, claudeMood, claudeEnergy, claudeDanceability, claudeVibeTags } of updates) {
        await trx
          .updateTable("track")
          .set({ claudeMood, claudeEnergy, claudeDanceability, claudeVibeTags, updatedAt: now })
          .where("id", "=", id)
          .execute();
      }
    });
  },

  async setEnrichmentVersion(
    version: number,
    limit: number
  ): Promise<number> {
    const result = await db
      .updateTable("track")
      .set({ enrichmentVersion: version, enrichedAt: new Date() })
      .where(
        "id",
        "in",
        db
          .selectFrom("track")
          .select("id")
          .where("enrichmentVersion", "<", version)
          .limit(limit)
      )
      .execute();
    return Number(result[0]?.numUpdatedRows ?? 0);
  },

  async countByUserId(userId: string): Promise<number> {
    const result = await db
      .selectFrom("likedSong")
      .where("userId", "=", userId)
      .select(db.fn.countAll<number>().as("count"))
      .executeTakeFirstOrThrow();
    return result.count;
  },

  async upsertMany(userId: string, songs: SpotifyLikedSong[]): Promise<void> {
    if (songs.length === 0) return;

    const batches = chunk(songs, 500);

    for (const batch of batches) {
      await db.transaction().execute(async (trx) => {
        const now = new Date();

        // 1. Deduplicate artists across all songs in this batch
        const artistMap = new Map<string, string>();
        for (const song of batch) {
          for (const a of song.artists) {
            artistMap.set(a.spotifyId, a.name);
          }
        }
        const uniqueArtists = Array.from(artistMap.entries()).map(
          ([spotifyId, name]) => ({
            id: createId(),
            spotifyId,
            name,
            updatedAt: now,
          })
        );

        if (uniqueArtists.length > 0) {
          await trx
            .insertInto("artist")
            .values(uniqueArtists)
            .onConflict((oc) =>
              oc.column("spotifyId").doUpdateSet({
                name: (eb) => eb.ref("excluded.name"),
                updatedAt: (eb) => eb.ref("excluded.updatedAt"),
              })
            )
            .execute();
        }

        // 2. Look up artist IDs
        const artistSpotifyIds = Array.from(artistMap.keys());
        const artists = await trx
          .selectFrom("artist")
          .where("spotifyId", "in", artistSpotifyIds)
          .select(["id", "spotifyId"])
          .execute();

        const spotifyIdToArtistId = new Map(
          artists.map((a) => [a.spotifyId, a.id])
        );

        // 3. Upsert tracks
        await trx
          .insertInto("track")
          .values(
            batch.map((song) => ({
              id: createId(),
              spotifyId: song.spotifyId,
              name: song.name,
              album: song.album,
              albumArtUrl: song.albumArtUrl,
              spotifyPopularity: song.spotifyPopularity,
              spotifyDurationMs: song.spotifyDurationMs,
              spotifyReleaseDate: song.spotifyReleaseDate,
              updatedAt: now,
            }))
          )
          .onConflict((oc) =>
            oc.column("spotifyId").doUpdateSet({
              name: (eb) => eb.ref("excluded.name"),
              album: (eb) => eb.ref("excluded.album"),
              albumArtUrl: (eb) => eb.ref("excluded.albumArtUrl"),
              spotifyPopularity: (eb) => eb.ref("excluded.spotifyPopularity"),
              spotifyDurationMs: (eb) => eb.ref("excluded.spotifyDurationMs"),
              spotifyReleaseDate: (eb) =>
                eb.ref("excluded.spotifyReleaseDate"),
              updatedAt: (eb) => eb.ref("excluded.updatedAt"),
            })
          )
          .execute();

        // 4. Look up track IDs
        const spotifyIds = batch.map((s) => s.spotifyId);
        const tracks = await trx
          .selectFrom("track")
          .where("spotifyId", "in", spotifyIds)
          .select(["id", "spotifyId"])
          .execute();

        const spotifyIdToTrackId = new Map(
          tracks.map((t) => [t.spotifyId, t.id])
        );

        // 5. Insert track_artist join rows
        const trackArtistValues: {
          trackId: string;
          artistId: string;
          position: number;
        }[] = [];
        for (const song of batch) {
          const trackId = spotifyIdToTrackId.get(song.spotifyId);
          if (!trackId) {
            throw new Error(
              `Track not found for spotifyId: ${song.spotifyId}`
            );
          }
          for (let i = 0; i < song.artists.length; i++) {
            const artistId = spotifyIdToArtistId.get(
              song.artists[i]!.spotifyId
            );
            if (!artistId) {
              throw new Error(
                `Artist not found for spotifyId: ${song.artists[i]!.spotifyId}`
              );
            }
            trackArtistValues.push({ trackId, artistId, position: i });
          }
        }

        if (trackArtistValues.length > 0) {
          await trx
            .insertInto("trackArtist")
            .values(trackArtistValues)
            .onConflict((oc) =>
              oc.columns(["trackId", "artistId"]).doNothing()
            )
            .execute();
        }

        // 6. Upsert liked_song entries
        const likedSongValues = batch.map((song) => {
          const trackId = spotifyIdToTrackId.get(song.spotifyId);
          if (!trackId) {
            throw new Error(
              `Track not found for spotifyId: ${song.spotifyId}`
            );
          }
          return {
            id: createId(),
            userId,
            trackId,
            likedAt: song.likedAt,
          };
        });

        await trx
          .insertInto("likedSong")
          .values(likedSongValues)
          .onConflict((oc) =>
            oc.columns(["userId", "trackId"]).doNothing()
          )
          .execute();
      });
    }
  },
};
