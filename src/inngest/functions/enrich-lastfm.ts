import { inngest } from "@/lib/inngest";
import { LASTFM_ENRICHMENT_VERSION } from "@/lib/enrichment";
import { getArtistTopTags, getTrackTopTags } from "@/lib/lastfm";
import { artistRepository } from "@/repositories/artist.repository";
import { trackRepository } from "@/repositories/track.repository";

const LASTFM_CHUNK_SIZE = 200;
const SET_VERSION_CHUNK_SIZE = 1000;

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
              if (tags.length > 0) {
                updates.push({ id: artist.id, tags });
              }
            } catch (err) {
              console.warn(
                `Last.fm artist tag fetch failed for "${artist.name}":`,
                err instanceof Error ? err.message : err
              );
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

    let artistVersionOffset = 0;
    while (true) {
      const updated = await step.run(
        `enrich-artists/set-lastfm-version-${artistVersionOffset}`,
        async () => {
          return artistRepository.setEnrichmentVersion(
            "artistLastfmEnrichment",
            LASTFM_ENRICHMENT_VERSION,
            SET_VERSION_CHUNK_SIZE
          );
        }
      );
      if (updated < SET_VERSION_CHUNK_SIZE) break;
      artistVersionOffset += SET_VERSION_CHUNK_SIZE;
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
              if (tags.length > 0) {
                updates.push({ id: track.id, tags });
              }
            } catch (err) {
              console.warn(
                `Last.fm track tag fetch failed for "${track.artist} - ${track.name}":`,
                err instanceof Error ? err.message : err
              );
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

    let trackVersionOffset = 0;
    while (true) {
      const updated = await step.run(
        `enrich-tracks/set-lastfm-version-${trackVersionOffset}`,
        async () => {
          return trackRepository.setEnrichmentVersion(
            "trackLastfmEnrichment",
            LASTFM_ENRICHMENT_VERSION,
            SET_VERSION_CHUNK_SIZE
          );
        }
      );
      if (updated < SET_VERSION_CHUNK_SIZE) break;
      trackVersionOffset += SET_VERSION_CHUNK_SIZE;
    }

    return { artistsProcessed, tracksProcessed };
  }
);
