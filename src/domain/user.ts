export type UserTier = "FREE" | "STANDARD" | "POWER";
export type SyncStatus = "IDLE" | "SYNCING" | "FAILED";

export type User = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  tier: UserTier;
  songCount: number;
  syncStatus: SyncStatus;
  needsReauth: boolean;
  lastSyncedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};
