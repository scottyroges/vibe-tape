export type Track = {
  id: string;
  spotifyId: string;
  name: string;
  album: string;
  albumArtUrl: string | null;
  vibeMood: string | null;
  vibeEnergy: string | null;
  vibeDanceability: string | null;
  vibeGenres: string[];
  vibeTags: string[];
  vibeVersion: number;
  vibeUpdatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type TrackWithLikedAt = Track & { artist: string; likedAt: Date };

/**
 * Scoring-pipeline shape: Track + primary artist id (for per-artist cap)
 * and duration (for duration-based truncation). Produced by repository
 * joins that shape the data for `src/lib/playlist-scoring.ts`.
 */
export type TrackWithScoringFields = Track & {
  primaryArtistId: string;
  durationMs: number | null;
};

/**
 * UI-rendering shape: Track + display-ready artist string (comma-joined
 * list of all artists in `track_artist.position` order, produced by
 * PG `string_agg`). Avoids N+1 artist lookups when rendering a
 * playlist's seeds or generated tracks, and keeps "feat." artists.
 */
export type TrackWithDisplayFields = Track & {
  artistsDisplay: string;
};

export type LikedSong = {
  id: string;
  userId: string;
  trackId: string;
  likedAt: Date;
  createdAt: Date;
};

export type Artist = {
  id: string;
  spotifyId: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
};

export type TrackArtist = {
  trackId: string;
  artistId: string;
  position: number;
};

export type TrackSpotifyEnrichment = {
  trackId: string;
  popularity: number | null;
  durationMs: number | null;
  releaseDate: string | null;
  derivedEra: string | null;
  version: number;
  enrichedAt: Date | null;
};

export type TrackClaudeEnrichment = {
  trackId: string;
  mood: string | null;
  energy: string | null;
  danceability: string | null;
  vibeTags: string[];
  version: number;
  enrichedAt: Date | null;
};

export type TrackLastfmEnrichment = {
  trackId: string;
  tags: string[];
  version: number;
  enrichedAt: Date | null;
};

export type ArtistSpotifyEnrichment = {
  artistId: string;
  genres: string[];
  version: number;
  enrichedAt: Date | null;
};

export type ArtistLastfmEnrichment = {
  artistId: string;
  tags: string[];
  version: number;
  enrichedAt: Date | null;
};
