import { db } from "@/lib/db";
import type { Artist } from "@/domain/types";

async function findStaleBySpotify(version: number, limit: number): Promise<Artist[]> {
  return db
    .selectFrom("artist")
    .leftJoin(
      "artistSpotifyEnrichment",
      "artistSpotifyEnrichment.artistId",
      "artist.id"
    )
    .where((eb) =>
      eb.or([
        eb("artistSpotifyEnrichment.version", "is", null),
        eb("artistSpotifyEnrichment.version", "<", version),
      ])
    )
    .selectAll("artist")
    .limit(limit)
    .execute();
}

async function findStaleByLastfm(version: number, limit: number): Promise<Artist[]> {
  return db
    .selectFrom("artist")
    .leftJoin(
      "artistLastfmEnrichment",
      "artistLastfmEnrichment.artistId",
      "artist.id"
    )
    .where((eb) =>
      eb.or([
        eb("artistLastfmEnrichment.version", "is", null),
        eb("artistLastfmEnrichment.version", "<", version),
      ])
    )
    .selectAll("artist")
    .limit(limit)
    .execute();
}

export const artistRepository = {
  async findStale(
    table: "artistSpotifyEnrichment" | "artistLastfmEnrichment",
    version: number,
    limit: number
  ): Promise<Artist[]> {
    if (table === "artistSpotifyEnrichment") {
      return findStaleBySpotify(version, limit);
    }
    return findStaleByLastfm(version, limit);
  },

  async updateGenres(
    updates: { id: string; genres: string[] }[]
  ): Promise<void> {
    if (updates.length === 0) return;
    const now = new Date();
    for (const { id, genres } of updates) {
      await db
        .insertInto("artistSpotifyEnrichment")
        .values({ artistId: id, genres, enrichedAt: now })
        .onConflict((oc) =>
          oc.column("artistId").doUpdateSet({
            genres: (eb) => eb.ref("excluded.genres"),
            enrichedAt: (eb) => eb.ref("excluded.enrichedAt"),
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
          .insertInto("artistLastfmEnrichment")
          .values({ artistId: id, tags, enrichedAt: now })
          .onConflict((oc) =>
            oc.column("artistId").doUpdateSet({
              tags: (eb) => eb.ref("excluded.tags"),
              enrichedAt: (eb) => eb.ref("excluded.enrichedAt"),
            })
          )
          .execute();
      }
    });
  },

  async setEnrichmentVersion(
    table: "artistSpotifyEnrichment" | "artistLastfmEnrichment",
    version: number,
    limit: number
  ): Promise<number> {
    const result = await db
      .updateTable(table)
      .set({ version, enrichedAt: new Date() })
      .where(
        "artistId",
        "in",
        db
          .selectFrom(table)
          .select("artistId")
          .where("version", "<", version)
          .limit(limit)
      )
      .execute();
    return Number(result[0]?.numUpdatedRows ?? 0);
  },
};
