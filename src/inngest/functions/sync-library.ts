import { inngest } from "@/lib/inngest";
import { getValidToken } from "@/lib/spotify-token";
import { fetchLikedSongs, fetchArtists } from "@/lib/spotify";
import {
  SPOTIFY_ENRICHMENT_VERSION,
  CLAUDE_ENRICHMENT_VERSION,
  VIBE_DERIVATION_VERSION,
  SPOTIFY_EXTENDED_QUOTA,
  deriveEra,
} from "@/lib/enrichment";
import { buildClassifyPrompt } from "@/lib/prompts/classify-tracks";
import { classifyTracks } from "@/lib/claude";
import { deriveVibeProfile } from "@/lib/vibe-profile";
import { trackRepository } from "@/repositories/track.repository";
import { artistRepository } from "@/repositories/artist.repository";
import { userRepository } from "@/repositories/user.repository";

const FETCH_CHUNK_SIZE = 2000;
const ARTIST_GENRE_CHUNK_SIZE = 500;
const TRACK_ERA_CHUNK_SIZE = 1000;
const CLAUDE_CLASSIFY_CHUNK_SIZE = 500;
const CLAUDE_BATCH_SIZE = 50;
const VIBE_DERIVATION_CHUNK_SIZE = 500;

const VALID_ENERGY_VALUES = new Set(["low", "medium", "high"]);

function isValidClassification(c: unknown): c is {
  mood: string;
  energy: "low" | "medium" | "high";
  danceability: "low" | "medium" | "high";
  vibeTags: string[];
} {
  if (!c || typeof c !== "object") return false;
  const obj = c as Record<string, unknown>;
  return (
    typeof obj.mood === "string" &&
    obj.mood.length > 0 &&
    VALID_ENERGY_VALUES.has(obj.energy as string) &&
    VALID_ENERGY_VALUES.has(obj.danceability as string) &&
    Array.isArray(obj.vibeTags) &&
    obj.vibeTags.length > 0 &&
    obj.vibeTags.every((t: unknown) => typeof t === "string")
  );
}

export const syncLibrary = inngest.createFunction(
  {
    id: "sync-library",
    retries: 3,
    concurrency: [{ key: "event.data.userId", limit: 1 }],
    triggers: [{ event: "library/sync.requested" }],
    onFailure: async ({ event }) => {
      const userId = event.data.event.data.userId;
      if (typeof userId === "string") {
        await userRepository.setSyncStatus(userId, "FAILED");
      }
    },
  },
  async ({ event, step }) => {
    const userId = event.data.userId;
    if (typeof userId !== "string") {
      throw new Error("library/sync.requested requires a string userId");
    }

    // Also set by the tRPC mutation, but repeated here so the function is
    // self-contained if triggered from a different entry point (e.g. cron).
    await step.run("set-syncing", async () => {
      await userRepository.setSyncStatus(userId, "SYNCING");
    });

    const token = await step.run("get-token", async () => {
      const result = await getValidToken(userId);
      if (!result) {
        throw new Error(
          `No valid Spotify token for user ${userId}. User may need to re-authenticate.`
        );
      }
      return result;
    });

    // Fetch and upsert in chunks to keep memory bounded.
    // Each iteration: fetch up to FETCH_CHUNK_SIZE songs, then upsert immediately.
    // The track repository handles internal 500-song batching.
    let totalSynced = 0;
    let fetchOffset = 0;
    let nextUrl: string | null = null;

    while (true) {
      const result = await step.run(
        `fetch-songs-${fetchOffset}`,
        async () => {
          return fetchLikedSongs(token.accessToken, {
            startUrl: nextUrl ?? undefined,
            maxTracks: FETCH_CHUNK_SIZE,
          });
        }
      );

      // Inngest serializes step outputs to JSON, so Date becomes string.
      const rehydrated = result.songs.map((s) => ({
        ...s,
        likedAt: new Date(s.likedAt),
      }));

      await step.run(`upsert-data-${fetchOffset}`, async () => {
        await trackRepository.upsertMany(userId, rehydrated);
      });

      totalSynced += result.songs.length;
      nextUrl = result.nextUrl;
      fetchOffset += result.songs.length;

      if (!result.nextUrl) break;
    }

    // ── Artist Enrichment ──

    // Step 5a: Spotify genres
    // Requires extended quota access — gated by SPOTIFY_EXTENDED_QUOTA flag.
    // See: .personal/docs/notes/spotify-dev-mode-restrictions.md
    if (SPOTIFY_EXTENDED_QUOTA) {
      let artistGenreOffset = 0;
      while (true) {
        const processed = await step.run(
          `enrich-artists/spotify-genres-${artistGenreOffset}`,
          async () => {
            const stale = await artistRepository.findStale(
              "artistSpotifyEnrichment",
              SPOTIFY_ENRICHMENT_VERSION,
              ARTIST_GENRE_CHUNK_SIZE
            );
            if (stale.length === 0) return 0;

            const genreMap = await fetchArtists(
              token.accessToken,
              stale.map((a) => a.spotifyId)
            );

            const updates = stale
              .filter((a) => genreMap.has(a.spotifyId))
              .map((a) => ({
                id: a.id,
                genres: genreMap.get(a.spotifyId)!,
              }));

            await artistRepository.updateGenres(updates);
            return stale.length;
          }
        );
        if (processed < ARTIST_GENRE_CHUNK_SIZE) break;
        artistGenreOffset += ARTIST_GENRE_CHUNK_SIZE;
      }
    }

    // ── Track Enrichment ──

    // Step 6a: Derived era
    let trackEraOffset = 0;
    while (true) {
      const processed = await step.run(
        `enrich-tracks/era-${trackEraOffset}`,
        async () => {
          const stale = await trackRepository.findStale(
            SPOTIFY_ENRICHMENT_VERSION,
            TRACK_ERA_CHUNK_SIZE
          );
          if (stale.length === 0) return 0;

          const updates = stale.map((t) => ({
            id: t.id,
            derivedEra: deriveEra(t.releaseDate),
          }));

          await trackRepository.updateDerivedEra(updates);
          return stale.length;
        }
      );
      if (processed < TRACK_ERA_CHUNK_SIZE) break;
      trackEraOffset += TRACK_ERA_CHUNK_SIZE;
    }

    // Step 6b: Claude classify
    let claudeOffset = 0;
    while (true) {
      const processed = await step.run(
        `enrich-tracks/claude-classify-${claudeOffset}`,
        async () => {
          const stale = await trackRepository.findStaleWithArtists(
            CLAUDE_ENRICHMENT_VERSION,
            CLAUDE_CLASSIFY_CHUNK_SIZE
          );
          if (stale.length === 0) return 0;

          const batches: (typeof stale)[] = [];
          for (let i = 0; i < stale.length; i += CLAUDE_BATCH_SIZE) {
            batches.push(stale.slice(i, i + CLAUDE_BATCH_SIZE));
          }

          const batchResults = await Promise.all(
            batches.map(async (batch, batchIdx) => {
              const { system, user } = buildClassifyPrompt(
                batch.map((t) => ({ name: t.name, artist: t.artist }))
              );
              const { results, inputTokens, outputTokens } =
                await classifyTracks(system, user);

              console.log(
                `Claude classify batch ${batchIdx}: ${inputTokens} input, ${outputTokens} output tokens`
              );

              return batch.map((track, j) => {
                const classification = j < results.length ? results[j] : null;
                if (classification && isValidClassification(classification)) {
                  return {
                    id: track.id,
                    mood: classification.mood as string | null,
                    energy: classification.energy as string | null,
                    danceability: classification.danceability as string | null,
                    vibeTags: classification.vibeTags,
                  };
                }
                return {
                  id: track.id,
                  mood: null as string | null,
                  energy: null as string | null,
                  danceability: null as string | null,
                  vibeTags: [] as string[],
                };
              });
            })
          );

          const updates = batchResults.flat();

          await trackRepository.updateClaudeClassification(updates);
          return stale.length;
        }
      );
      if (processed < CLAUDE_CLASSIFY_CHUNK_SIZE) break;
      claudeOffset += CLAUDE_CLASSIFY_CHUNK_SIZE;
    }

    // ── Vibe Profile Derivation ──
    // Merges Claude + Spotify era + Last.fm (if already populated) into the
    // canonical vibeMood/vibeEnergy/vibeGenres/vibeTags columns on Track.
    // Runs at the end of sync; the same step also runs at the end of
    // enrich-lastfm to re-derive tracks after Last.fm data loads.
    let vibeOffset = 0;
    while (true) {
      const processed = await step.run(
        `derive-vibe-profile-${vibeOffset}`,
        async () => {
          const stale = await trackRepository.findStaleVibeProfiles(
            VIBE_DERIVATION_VERSION,
            VIBE_DERIVATION_CHUNK_SIZE
          );
          if (stale.length === 0) return 0;

          const updates = stale.map((t) => {
            const profile = deriveVibeProfile({
              claude: t.claude,
              trackSpotify: t.trackSpotify,
              trackLastfm: t.trackLastfm,
              artistLastfmTags: t.artistLastfmTags,
              artistNames: t.artistNames,
            });
            return { id: t.id, ...profile };
          });

          await trackRepository.updateVibeProfiles(updates);
          return stale.length;
        }
      );
      if (processed < VIBE_DERIVATION_CHUNK_SIZE) break;
      vibeOffset += VIBE_DERIVATION_CHUNK_SIZE;
    }

    await step.run("update-status", async () => {
      await userRepository.updateSyncMetrics(userId);
      await userRepository.setSyncStatus(userId, "IDLE");
    });

    await step.sendEvent("request-lastfm-enrichment", {
      name: "enrichment/lastfm.requested",
      data: {},
    });

    return { synced: totalSynced };
  }
);
