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
  addedAt: Date;
  createdAt: Date;
  updatedAt: Date;
};
