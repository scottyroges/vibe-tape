import { db } from "@/lib/db";
import type { User } from "@/domain/types";

export const userRepository = {
  async findById(id: string): Promise<User | null> {
    return (
      (await db
        .selectFrom("user")
        .where("id", "=", id)
        .selectAll()
        .executeTakeFirst()) ?? null
    );
  },

  async findByEmail(email: string): Promise<User | null> {
    return (
      (await db
        .selectFrom("user")
        .where("email", "=", email)
        .selectAll()
        .executeTakeFirst()) ?? null
    );
  },

  async findDueForSync(): Promise<User[]> {
    return db
      .selectFrom("user")
      .where("needsReauth", "=", false)
      .selectAll()
      .execute();
  },

  async updateSyncStatus(userId: string): Promise<void> {
    const { count } = await db
      .selectFrom("likedSong")
      .where("userId", "=", userId)
      .select(db.fn.countAll<number>().as("count"))
      .executeTakeFirstOrThrow();

    await db
      .updateTable("user")
      .set({
        songCount: count,
        lastSyncedAt: new Date(),
        updatedAt: new Date(),
      })
      .where("id", "=", userId)
      .execute();
  },
};
