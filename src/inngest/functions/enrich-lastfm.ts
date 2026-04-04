import { inngest } from "@/lib/inngest";
import { LASTFM_ENRICHMENT_VERSION } from "@/lib/enrichment";
import { getArtistTopTags, getTrackTopTags } from "@/lib/lastfm";
import { artistRepository } from "@/repositories/artist.repository";
import { trackRepository } from "@/repositories/track.repository";

const LASTFM_CHUNK_SIZE = 100;

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

    return { artistsProcessed, tracksProcessed };
  }
);
