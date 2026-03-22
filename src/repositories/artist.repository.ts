import { db } from "@/lib/db";
import type { Artist } from "@/domain/types";

export const artistRepository = {
  async findStale(version: number, limit: number): Promise<Artist[]> {
    return db
      .selectFrom("artist")
      .where("enrichmentVersion", "<", version)
      .selectAll()
      .limit(limit)
      .execute();
  },

  async updateGenres(
    updates: { id: string; spotifyGenres: string[] }[]
  ): Promise<void> {
    if (updates.length === 0) return;
    const now = new Date();
    for (const { id, spotifyGenres } of updates) {
      await db
        .updateTable("artist")
        .set({ spotifyGenres, updatedAt: now })
        .where("id", "=", id)
        .execute();
    }
  },

  async updateLastfmTags(
    updates: { id: string; lastfmTags: string[] }[]
  ): Promise<void> {
    if (updates.length === 0) return;
    await db.transaction().execute(async (trx) => {
      const now = new Date();
      for (const { id, lastfmTags } of updates) {
        await trx
          .updateTable("artist")
          .set({ lastfmTags, updatedAt: now })
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
      .updateTable("artist")
      .set({ enrichmentVersion: version, enrichedAt: new Date() })
      .where(
        "id",
        "in",
        db
          .selectFrom("artist")
          .select("id")
          .where("enrichmentVersion", "<", version)
          .limit(limit)
      )
      .execute();
    return Number(result[0]?.numUpdatedRows ?? 0);
  },
};
