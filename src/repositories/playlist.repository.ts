import { db } from "@/lib/db";
import type { Playlist } from "@/domain/types";

export const playlistRepository = {
  async findById(id: string): Promise<Playlist | null> {
    return (
      (await db
        .selectFrom("playlist")
        .where("id", "=", id)
        .selectAll()
        .executeTakeFirst()) ?? null
    );
  },

  async findByUserId(userId: string): Promise<Playlist[]> {
    return db
      .selectFrom("playlist")
      .where("userId", "=", userId)
      .selectAll()
      .orderBy("createdAt", "desc")
      .execute();
  },
};
