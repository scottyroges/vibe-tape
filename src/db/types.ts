import type { ColumnType } from "kysely";
export type Generated<T> = T extends ColumnType<infer S, infer I, infer U>
  ? ColumnType<S, I | undefined, U>
  : ColumnType<T, T | undefined, T>;
export type Timestamp = ColumnType<Date, Date | string, Date | string>;

import type { UserTier } from "./enums";

export type Account = {
    id: string;
    userId: string;
    accountId: string;
    providerId: string;
    accessToken: string | null;
    refreshToken: string | null;
    idToken: string | null;
    accessTokenExpiresAt: Timestamp | null;
    refreshTokenExpiresAt: Timestamp | null;
    scope: string | null;
    password: string | null;
    createdAt: Generated<Timestamp>;
    updatedAt: Timestamp;
};
export type Playlist = {
    id: string;
    userId: string;
    spotifyPlaylistId: string | null;
    vibeName: string;
    vibeDescription: string | null;
    seedSongIds: string[];
    artImageUrl: string | null;
    lastSyncedAt: Timestamp | null;
    createdAt: Generated<Timestamp>;
    updatedAt: Timestamp;
};
export type Session = {
    id: string;
    userId: string;
    token: string;
    expiresAt: Timestamp;
    ipAddress: string | null;
    userAgent: string | null;
    createdAt: Generated<Timestamp>;
    updatedAt: Timestamp;
};
export type Song = {
    id: string;
    userId: string;
    spotifyId: string;
    name: string;
    artist: string;
    album: string;
    albumArtUrl: string | null;
    lastfmGenres: string | null;
    bpm: number | null;
    era: string | null;
    addedAt: Timestamp;
    createdAt: Generated<Timestamp>;
    updatedAt: Timestamp;
};
export type User = {
    id: string;
    name: string;
    email: string;
    emailVerified: Generated<boolean>;
    image: string | null;
    tier: Generated<UserTier>;
    songCount: Generated<number>;
    needsReauth: Generated<boolean>;
    lastSyncedAt: Timestamp | null;
    createdAt: Generated<Timestamp>;
    updatedAt: Timestamp;
};
export type Verification = {
    id: string;
    identifier: string;
    value: string;
    expiresAt: Timestamp;
    createdAt: Generated<Timestamp>;
    updatedAt: Timestamp;
};
export type DB = {
    account: Account;
    playlist: Playlist;
    session: Session;
    song: Song;
    user: User;
    verification: Verification;
};
