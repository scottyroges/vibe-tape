import { inngest } from "@/lib/inngest";
import { getValidToken } from "@/lib/spotify-token";
import { fetchLikedSongs, fetchArtists } from "@/lib/spotify";
import { CURRENT_ENRICHMENT_VERSION, deriveEra } from "@/lib/enrichment";
import { trackRepository } from "@/repositories/track.repository";
import { artistRepository } from "@/repositories/artist.repository";
import { userRepository } from "@/repositories/user.repository";

const FETCH_CHUNK_SIZE = 2000;
const ARTIST_GENRE_CHUNK_SIZE = 500;
const TRACK_ERA_CHUNK_SIZE = 1000;
const SET_VERSION_CHUNK_SIZE = 1000;

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
    let artistGenreOffset = 0;
    while (true) {
      const processed = await step.run(
        `enrich-artists/spotify-genres-${artistGenreOffset}`,
        async () => {
          const stale = await artistRepository.findStale(
            CURRENT_ENRICHMENT_VERSION,
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
              spotifyGenres: genreMap.get(a.spotifyId)!,
            }));

          await artistRepository.updateGenres(updates);
          return stale.length;
        }
      );
      if (processed < ARTIST_GENRE_CHUNK_SIZE) break;
      artistGenreOffset += ARTIST_GENRE_CHUNK_SIZE;
    }

    // Step 5b: Last.fm tags (Phase 4 — no-op)

    // Step 5c: Set artist enrichment version
    let artistVersionOffset = 0;
    while (true) {
      const updated = await step.run(
        `enrich-artists/set-version-${artistVersionOffset}`,
        async () => {
          return artistRepository.setEnrichmentVersion(
            CURRENT_ENRICHMENT_VERSION,
            SET_VERSION_CHUNK_SIZE
          );
        }
      );
      if (updated < SET_VERSION_CHUNK_SIZE) break;
      artistVersionOffset += SET_VERSION_CHUNK_SIZE;
    }

    // ── Track Enrichment ──

    // Step 6a: Derived era
    let trackEraOffset = 0;
    while (true) {
      const processed = await step.run(
        `enrich-tracks/era-${trackEraOffset}`,
        async () => {
          const stale = await trackRepository.findStale(
            CURRENT_ENRICHMENT_VERSION,
            TRACK_ERA_CHUNK_SIZE
          );
          if (stale.length === 0) return 0;

          const updates = stale
            .map((t) => ({
              id: t.id,
              derivedEra: deriveEra(t.spotifyReleaseDate),
            }))
            .filter(
              (u): u is { id: string; derivedEra: string } =>
                u.derivedEra !== null
            );

          await trackRepository.updateDerivedEra(updates);
          return stale.length;
        }
      );
      if (processed < TRACK_ERA_CHUNK_SIZE) break;
      trackEraOffset += TRACK_ERA_CHUNK_SIZE;
    }

    // Step 6b: Claude classify (Phase 3 — no-op)
    // Step 6c: Last.fm tags (Phase 4 — no-op)

    // Step 6d: Set track enrichment version
    let trackVersionOffset = 0;
    while (true) {
      const updated = await step.run(
        `enrich-tracks/set-version-${trackVersionOffset}`,
        async () => {
          return trackRepository.setEnrichmentVersion(
            CURRENT_ENRICHMENT_VERSION,
            SET_VERSION_CHUNK_SIZE
          );
        }
      );
      if (updated < SET_VERSION_CHUNK_SIZE) break;
      trackVersionOffset += SET_VERSION_CHUNK_SIZE;
    }

    await step.run("update-status", async () => {
      await userRepository.updateSyncMetrics(userId);
      await userRepository.setSyncStatus(userId, "IDLE");
    });

    return { synced: totalSynced };
  }
);
