export const UserTier = {
    FREE: "FREE",
    STANDARD: "STANDARD",
    POWER: "POWER"
} as const;
export type UserTier = (typeof UserTier)[keyof typeof UserTier];
