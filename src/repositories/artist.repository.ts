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
};
