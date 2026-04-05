export const UserTier = {
    FREE: "FREE",
    STANDARD: "STANDARD",
    POWER: "POWER"
} as const;
export type UserTier = (typeof UserTier)[keyof typeof UserTier];
export const SyncStatus = {
    IDLE: "IDLE",
    SYNCING: "SYNCING",
    FAILED: "FAILED"
} as const;
export type SyncStatus = (typeof SyncStatus)[keyof typeof SyncStatus];
export const PlaylistStatus = {
    GENERATING: "GENERATING",
    PENDING: "PENDING",
    SAVED: "SAVED",
    FAILED: "FAILED"
} as const;
export type PlaylistStatus = (typeof PlaylistStatus)[keyof typeof PlaylistStatus];
