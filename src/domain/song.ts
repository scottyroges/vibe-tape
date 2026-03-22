export type Track = {
  id: string;
  spotifyId: string;
  name: string;
  album: string;
  albumArtUrl: string | null;
  spotifyPopularity: number | null;
  spotifyDurationMs: number | null;
  spotifyReleaseDate: string | null;
  derivedEra: string | null;
  lastfmTags: string[];
  enrichmentVersion: number;
  enrichedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type TrackWithLikedAt = Track & { artist: string; likedAt: Date };

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
  spotifyGenres: string[];
  lastfmTags: string[];
  enrichmentVersion: number;
  enrichedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type TrackArtist = {
  trackId: string;
  artistId: string;
  position: number;
};
