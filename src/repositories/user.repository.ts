import { db } from "@/lib/db";
import type { User, SyncStatus } from "@/domain/types";

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

  async setSyncStatus(userId: string, status: SyncStatus): Promise<void> {
    await db
      .updateTable("user")
      .set({ syncStatus: status, updatedAt: new Date() })
      .where("id", "=", userId)
      .execute();
  },

  async trySetSyncing(userId: string): Promise<boolean> {
    const result = await db
      .updateTable("user")
      .set({ syncStatus: "SYNCING" as SyncStatus, updatedAt: new Date() })
      .where("id", "=", userId)
      .where("syncStatus", "!=", "SYNCING" as SyncStatus)
      .executeTakeFirst();
    return result.numUpdatedRows > BigInt(0);
  },

  async getSyncStatus(userId: string): Promise<SyncStatus> {
    const result = await db
      .selectFrom("user")
      .where("id", "=", userId)
      .select("syncStatus")
      .executeTakeFirstOrThrow();
    return result.syncStatus as SyncStatus;
  },

  async updateSyncMetrics(userId: string): Promise<void> {
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
