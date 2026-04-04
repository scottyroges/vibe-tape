import { db } from "@/lib/db";
import { sql } from "kysely";
import { createId } from "@/lib/id";
import type { Track, TrackWithLikedAt } from "@/domain/types";
import type { SpotifyLikedSong } from "@/lib/spotify";
import {
  SPOTIFY_ENRICHMENT_VERSION,
  CLAUDE_ENRICHMENT_VERSION,
  LASTFM_ENRICHMENT_VERSION,
} from "@/lib/enrichment";

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

  async findStale(
    version: number,
    limit: number
  ): Promise<(Track & { releaseDate: string | null })[]> {
    const rows = await db
      .selectFrom("track")
      .leftJoin(
        "trackSpotifyEnrichment",
        "trackSpotifyEnrichment.trackId",
        "track.id"
      )
      .where((eb) =>
        eb.or([
          eb("trackSpotifyEnrichment.version", "is", null),
          eb("trackSpotifyEnrichment.version", "<", version),
        ])
      )
      .selectAll("track")
      .select("trackSpotifyEnrichment.releaseDate")
      .limit(limit)
      .execute();

    return rows as (Track & { releaseDate: string | null })[];
  },

  async findStaleWithArtists(
    version: number,
    limit: number
  ): Promise<(Track & { artist: string })[]> {
    const rows = await db
      .selectFrom("track")
      .innerJoin("trackArtist", "trackArtist.trackId", "track.id")
      .innerJoin("artist", "artist.id", "trackArtist.artistId")
      .leftJoin(
        "trackClaudeEnrichment",
        "trackClaudeEnrichment.trackId",
        "track.id"
      )
      .where((eb) =>
        eb.or([
          eb("trackClaudeEnrichment.version", "is", null),
          eb("trackClaudeEnrichment.version", "<", version),
        ])
      )
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
      .leftJoin(
        "trackLastfmEnrichment",
        "trackLastfmEnrichment.trackId",
        "track.id"
      )
      .where((eb) =>
        eb.or([
          eb("trackLastfmEnrichment.version", "is", null),
          eb("trackLastfmEnrichment.version", "<", version),
        ])
      )
      .where("trackArtist.position", "=", 0)
      .selectAll("track")
      .select("artist.name as artist")
      .limit(limit)
      .execute();

    return rows as (Track & { artist: string })[];
  },

  async updateDerivedEra(
    updates: { id: string; derivedEra: string | null }[]
  ): Promise<void> {
    if (updates.length === 0) return;
    const now = new Date();
    for (const { id, derivedEra } of updates) {
      await db
        .insertInto("trackSpotifyEnrichment")
        .values({
          trackId: id,
          derivedEra,
          enrichedAt: now,
          version: SPOTIFY_ENRICHMENT_VERSION,
        })
        .onConflict((oc) =>
          oc.column("trackId").doUpdateSet({
            derivedEra: (eb) => eb.ref("excluded.derivedEra"),
            enrichedAt: (eb) => eb.ref("excluded.enrichedAt"),
            version: (eb) => eb.ref("excluded.version"),
          })
        )
        .execute();
    }
  },

  async updateLastfmTags(
    updates: { id: string; tags: string[] }[]
  ): Promise<void> {
    if (updates.length === 0) return;
    await db.transaction().execute(async (trx) => {
      const now = new Date();
      for (const { id, tags } of updates) {
        await trx
          .insertInto("trackLastfmEnrichment")
          .values({
            trackId: id,
            tags,
            enrichedAt: now,
            version: LASTFM_ENRICHMENT_VERSION,
          })
          .onConflict((oc) =>
            oc.column("trackId").doUpdateSet({
              tags: (eb) => eb.ref("excluded.tags"),
              enrichedAt: (eb) => eb.ref("excluded.enrichedAt"),
              version: (eb) => eb.ref("excluded.version"),
            })
          )
          .execute();
      }
    });
  },

  async updateClaudeClassification(
    updates: {
      id: string;
      mood: string | null;
      energy: string | null;
      danceability: string | null;
      vibeTags: string[];
    }[]
  ): Promise<void> {
    if (updates.length === 0) return;
    await db.transaction().execute(async (trx) => {
      const now = new Date();
      for (const { id, mood, energy, danceability, vibeTags } of updates) {
        await trx
          .insertInto("trackClaudeEnrichment")
          .values({
            trackId: id,
            mood,
            energy,
            danceability,
            vibeTags,
            enrichedAt: now,
            version: CLAUDE_ENRICHMENT_VERSION,
          })
          .onConflict((oc) =>
            oc.column("trackId").doUpdateSet({
              mood: (eb) => eb.ref("excluded.mood"),
              energy: (eb) => eb.ref("excluded.energy"),
              danceability: (eb) => eb.ref("excluded.danceability"),
              vibeTags: (eb) => eb.ref("excluded.vibeTags"),
              enrichedAt: (eb) => eb.ref("excluded.enrichedAt"),
              version: (eb) => eb.ref("excluded.version"),
            })
          )
          .execute();
      }
    });
  },

  async setEnrichmentVersion(
    table: "trackSpotifyEnrichment" | "trackClaudeEnrichment" | "trackLastfmEnrichment",
    version: number,
    limit: number
  ): Promise<number> {
    const result = await db
      .updateTable(table)
      .set({ version, enrichedAt: new Date() })
      .where(
        "trackId",
        "in",
        db
          .selectFrom(table)
          .select("trackId")
          .where("version", "<", version)
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
              updatedAt: now,
            }))
          )
          .onConflict((oc) =>
            oc.column("spotifyId").doUpdateSet({
              name: (eb) => eb.ref("excluded.name"),
              album: (eb) => eb.ref("excluded.album"),
              albumArtUrl: (eb) => eb.ref("excluded.albumArtUrl"),
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

        // 7. Seed TrackSpotifyEnrichment rows (version 0)
        const spotifyEnrichmentValues = batch.map((song) => {
          const trackId = spotifyIdToTrackId.get(song.spotifyId)!;
          return {
            trackId,
            popularity: song.spotifyPopularity,
            durationMs: song.spotifyDurationMs,
            releaseDate: song.spotifyReleaseDate,
          };
        });

        await trx
          .insertInto("trackSpotifyEnrichment")
          .values(spotifyEnrichmentValues)
          .onConflict((oc) =>
            oc.column("trackId").doUpdateSet({
              popularity: (eb) => eb.ref("excluded.popularity"),
              durationMs: (eb) => eb.ref("excluded.durationMs"),
              releaseDate: (eb) => eb.ref("excluded.releaseDate"),
            })
          )
          .execute();

        // 8. Seed ArtistSpotifyEnrichment rows (version 0)
        const artistEnrichmentValues = artists.map((a) => ({
          artistId: a.id,
        }));

        if (artistEnrichmentValues.length > 0) {
          await trx
            .insertInto("artistSpotifyEnrichment")
            .values(artistEnrichmentValues)
            .onConflict((oc) => oc.column("artistId").doNothing())
            .execute();
        }
      });
    }
  },
};
