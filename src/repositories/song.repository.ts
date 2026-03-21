import { db } from "@/lib/db";
import type { Song } from "@/domain/types";

export const songRepository = {
  async findByUserId(userId: string): Promise<Song[]> {
    return db
      .selectFrom("song")
      .where("userId", "=", userId)
      .selectAll()
      .execute();
  },

  async findByIds(ids: string[]): Promise<Song[]> {
    if (ids.length === 0) return [];
    return db
      .selectFrom("song")
      .where("id", "in", ids)
      .selectAll()
      .execute();
  },

  async countByUserId(userId: string): Promise<number> {
    const result = await db
      .selectFrom("song")
      .where("userId", "=", userId)
      .select(db.fn.countAll<number>().as("count"))
      .executeTakeFirstOrThrow();
    return result.count;
  },
};
