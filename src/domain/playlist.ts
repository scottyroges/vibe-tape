import type { VibeProfile } from "@/lib/vibe-profile";
import type { PlaylistStatus } from "@/db/enums";

/**
 * Per-track score triple persisted alongside `generatedTrackIds`. Stored
 * as JSONB so the three numbers stay grouped with their `trackId` —
 * parallel arrays would be fragile (any append/replace mismatch would
 * silently misalign the scores with the tracks).
 *
 * The same shape comes back from `computeFinalScore` in
 * `src/lib/playlist-scoring.ts`; the Inngest functions persist it here
 * and the detail page reads it back for display and future audit.
 */
export type TrackScore = {
  trackId: string;
  claude: number;
  math: number;
  final: number;
};

export type Playlist = {
  id: string;
  userId: string;
  spotifyPlaylistId: string | null;
  vibeName: string;
  vibeDescription: string | null;
  seedSongIds: string[];
  status: PlaylistStatus;
  generatedTrackIds: string[];
  /**
   * Per-track score triples in the same order as `generatedTrackIds`.
   * `null` on legacy rows created before scores were persisted — the UI
   * and router handle that case by omitting score columns.
   */
  trackScores: TrackScore[] | null;
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
