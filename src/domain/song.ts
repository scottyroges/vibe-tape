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

export type LikedSong = {
  id: string;
  userId: string;
  trackId: string;
  addedAt: Date;
  createdAt: Date;
};
