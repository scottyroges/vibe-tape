import type { ColumnType } from "kysely";
export type Generated<T> = T extends ColumnType<infer S, infer I, infer U>
  ? ColumnType<S, I | undefined, U>
  : ColumnType<T, T | undefined, T>;
export type Timestamp = ColumnType<Date, Date | string, Date | string>;

import type { UserTier, SyncStatus, PlaylistStatus } from "./enums";

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
export type Artist = {
    id: string;
    spotifyId: string;
    name: string;
    createdAt: Generated<Timestamp>;
    updatedAt: Timestamp;
};
export type ArtistLastfmEnrichment = {
    artistId: string;
    tags: Generated<string[]>;
    version: Generated<number>;
    enrichedAt: Timestamp | null;
};
export type ArtistSpotifyEnrichment = {
    artistId: string;
    genres: Generated<string[]>;
    version: Generated<number>;
    enrichedAt: Timestamp | null;
};
export type LikedSong = {
    id: string;
    userId: string;
    trackId: string;
    likedAt: Timestamp;
    createdAt: Generated<Timestamp>;
};
export type Playlist = {
    id: string;
    userId: string;
    spotifyPlaylistId: string | null;
    vibeName: string;
    vibeDescription: string | null;
    seedSongIds: string[];
    status: Generated<PlaylistStatus>;
    generatedTrackIds: Generated<string[]>;
    targetDurationMinutes: Generated<number>;
    userIntent: string | null;
    claudeTarget: unknown | null;
    mathTarget: unknown | null;
    errorMessage: string | null;
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
export type Track = {
    id: string;
    spotifyId: string;
    name: string;
    album: string;
    albumArtUrl: string | null;
    vibeMood: string | null;
    vibeEnergy: string | null;
    vibeDanceability: string | null;
    vibeGenres: Generated<string[]>;
    vibeTags: Generated<string[]>;
    vibeVersion: Generated<number>;
    vibeUpdatedAt: Timestamp | null;
    createdAt: Generated<Timestamp>;
    updatedAt: Timestamp;
};
export type TrackArtist = {
    trackId: string;
    artistId: string;
    position: number;
};
export type TrackClaudeEnrichment = {
    trackId: string;
    mood: string | null;
    energy: string | null;
    danceability: string | null;
    vibeTags: Generated<string[]>;
    version: Generated<number>;
    enrichedAt: Timestamp | null;
};
export type TrackLastfmEnrichment = {
    trackId: string;
    tags: Generated<string[]>;
    version: Generated<number>;
    enrichedAt: Timestamp | null;
};
export type TrackSpotifyEnrichment = {
    trackId: string;
    popularity: number | null;
    durationMs: number | null;
    releaseDate: string | null;
    derivedEra: string | null;
    version: Generated<number>;
    enrichedAt: Timestamp | null;
};
export type User = {
    id: string;
    name: string;
    email: string;
    emailVerified: Generated<boolean>;
    image: string | null;
    tier: Generated<UserTier>;
    songCount: Generated<number>;
    syncStatus: Generated<SyncStatus>;
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
    artist: Artist;
    artistLastfmEnrichment: ArtistLastfmEnrichment;
    artistSpotifyEnrichment: ArtistSpotifyEnrichment;
    likedSong: LikedSong;
    playlist: Playlist;
    session: Session;
    track: Track;
    trackArtist: TrackArtist;
    trackClaudeEnrichment: TrackClaudeEnrichment;
    trackLastfmEnrichment: TrackLastfmEnrichment;
    trackSpotifyEnrichment: TrackSpotifyEnrichment;
    user: User;
    verification: Verification;
};
