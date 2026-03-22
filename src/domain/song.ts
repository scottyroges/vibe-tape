export type Track = {
  id: string;
  spotifyId: string;
  name: string;
  artist: string;
  album: string;
  albumArtUrl: string | null;
  lastfmGenres: string | null;
  bpm: number | null;
  era: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type TrackWithLikedAt = Track & { likedAt: Date };

export type LikedSong = {
  id: string;
  userId: string;
  trackId: string;
  likedAt: Date;
  createdAt: Date;
};
