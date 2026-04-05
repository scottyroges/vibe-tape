import { inngest } from "@/lib/inngest";
import {
  LASTFM_ENRICHMENT_VERSION,
  VIBE_DERIVATION_VERSION,
} from "@/lib/enrichment";
import { getArtistTopTags, getTrackTopTags } from "@/lib/lastfm";
import { deriveVibeProfile } from "@/lib/vibe-profile";
import { artistRepository } from "@/repositories/artist.repository";
import { trackRepository } from "@/repositories/track.repository";

const LASTFM_CHUNK_SIZE = 100;
const VIBE_DERIVATION_CHUNK_SIZE = 500;

export const enrichLastfm = inngest.createFunction(
  {
    id: "enrich-lastfm",
    retries: 3,
    concurrency: [{ limit: 1 }],
    triggers: [
      { event: "enrichment/lastfm.requested" },
      { cron: "0 0 * * *" },
    ],
  },
  async ({ step }) => {
    let artistsProcessed = 0;
    let tracksProcessed = 0;

    // ── Artist Last.fm tags ──

    let artistOffset = 0;
    while (true) {
      const processed = await step.run(
        `enrich-artists/lastfm-tags-${artistOffset}`,
        async () => {
          const stale = await artistRepository.findStale(
            "artistLastfmEnrichment",
            LASTFM_ENRICHMENT_VERSION,
            LASTFM_CHUNK_SIZE
          );
          if (stale.length === 0) return 0;

          const updates: { id: string; tags: string[] }[] = [];

          for (const artist of stale) {
            try {
              const tags = await getArtistTopTags(artist.name);
              updates.push({ id: artist.id, tags });
            } catch (err) {
              console.warn(
                `Last.fm artist tag fetch failed for "${artist.name}":`,
                err instanceof Error ? err.message : err
              );
              updates.push({ id: artist.id, tags: [] });
            }
          }

          await artistRepository.updateLastfmTags(updates);
          // Invalidate vibe profiles for every track joined to these
          // artists. Over-invalidates on cron no-op runs (tags unchanged),
          // but the re-derivation cost is negligible at personal scale.
          if (updates.length > 0) {
            await trackRepository.invalidateVibeProfilesByArtist(
              updates.map((u) => u.id)
            );
          }
          return stale.length;
        }
      );
      artistsProcessed += processed;
      if (processed < LASTFM_CHUNK_SIZE) break;
      artistOffset += LASTFM_CHUNK_SIZE;
    }

    // ── Track Last.fm tags ──

    let trackOffset = 0;
    while (true) {
      const processed = await step.run(
        `enrich-tracks/lastfm-tags-${trackOffset}`,
        async () => {
          const stale = await trackRepository.findStaleWithPrimaryArtist(
            LASTFM_ENRICHMENT_VERSION,
            LASTFM_CHUNK_SIZE
          );
          if (stale.length === 0) return 0;

          const updates: { id: string; tags: string[] }[] = [];

          for (const track of stale) {
            try {
              const tags = await getTrackTopTags(track.artist, track.name);
              updates.push({ id: track.id, tags });
            } catch (err) {
              console.warn(
                `Last.fm track tag fetch failed for "${track.artist} - ${track.name}":`,
                err instanceof Error ? err.message : err
              );
              updates.push({ id: track.id, tags: [] });
            }
          }

          await trackRepository.updateLastfmTags(updates);
          return stale.length;
        }
      );
      tracksProcessed += processed;
      if (processed < LASTFM_CHUNK_SIZE) break;
      trackOffset += LASTFM_CHUNK_SIZE;
    }

    // ── Vibe Profile Derivation ──
    // Re-derives tracks whose upstream enrichment data changed. Artist-level
    // invalidation from the artist step above zeroed vibeUpdatedAt on
    // affected tracks, and the staleness query's enrichedAt comparison
    // picks up tracks whose own Last.fm row was just updated.
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

    return { artistsProcessed, tracksProcessed };
  }
);
