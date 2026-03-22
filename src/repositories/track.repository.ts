import { db } from "@/lib/db";
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
    return db
      .selectFrom("track")
      .innerJoin("likedSong", "likedSong.trackId", "track.id")
      .where("likedSong.userId", "=", userId)
      .selectAll("track")
      .select("likedSong.likedAt")
      .orderBy("likedSong.likedAt", "desc")
      .execute();
  },

  async findByIds(ids: string[]): Promise<Track[]> {
    if (ids.length === 0) return [];
    return db
      .selectFrom("track")
      .where("id", "in", ids)
      .selectAll()
      .execute();
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

        // 1. Upsert tracks
        await trx
          .insertInto("track")
          .values(
            batch.map((song) => ({
              id: createId(),
              spotifyId: song.spotifyId,
              name: song.name,
              artist: song.artist,
              album: song.album,
              albumArtUrl: song.albumArtUrl,
              updatedAt: now,
            }))
          )
          .onConflict((oc) =>
            oc.column("spotifyId").doUpdateSet({
              name: (eb) => eb.ref("excluded.name"),
              artist: (eb) => eb.ref("excluded.artist"),
              album: (eb) => eb.ref("excluded.album"),
              albumArtUrl: (eb) => eb.ref("excluded.albumArtUrl"),
              updatedAt: (eb) => eb.ref("excluded.updatedAt"),
            })
          )
          .execute();

        // 2. Look up track IDs for this batch
        const spotifyIds = batch.map((s) => s.spotifyId);
        const tracks = await trx
          .selectFrom("track")
          .where("spotifyId", "in", spotifyIds)
          .select(["id", "spotifyId"])
          .execute();

        const spotifyIdToTrackId = new Map(
          tracks.map((t) => [t.spotifyId, t.id])
        );

        // 3. Upsert liked_song entries
        const likedSongValues = batch.map((song) => {
          const trackId = spotifyIdToTrackId.get(song.spotifyId);
          if (!trackId) {
            throw new Error(`Track not found for spotifyId: ${song.spotifyId}`);
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
