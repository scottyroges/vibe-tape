import type { VibeProfile } from "@/lib/vibe-profile";
import type { PlaylistStatus } from "@/db/enums";

export type Playlist = {
  id: string;
  userId: string;
  spotifyPlaylistId: string | null;
  vibeName: string;
  vibeDescription: string | null;
  seedSongIds: string[];
  status: PlaylistStatus;
  generatedTrackIds: string[];
  targetDurationMinutes: number;
  userIntent: string | null;
  claudeTarget: VibeProfile | null;
  mathTarget: VibeProfile | null;
  errorMessage: string | null;
  artImageUrl: string | null;
  lastSyncedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};
