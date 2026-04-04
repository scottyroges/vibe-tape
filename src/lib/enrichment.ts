export const SPOTIFY_ENRICHMENT_VERSION = 1;
export const CLAUDE_ENRICHMENT_VERSION = 1;
export const LASTFM_ENRICHMENT_VERSION = 1;
export const VIBE_DERIVATION_VERSION = 1;

/**
 * Spotify restricts batch artist endpoints and genre/popularity data for
 * apps in development mode. Set to true once extended quota access is approved.
 * See: .personal/docs/notes/spotify-dev-mode-restrictions.md
 */
export const SPOTIFY_EXTENDED_QUOTA = false;

/**
 * Derives a decade string from a Spotify release date.
 * Spotify returns dates as "2023-06-15", "2023-06", or "2023".
 */
export function deriveEra(releaseDate: string | null): string | null {
  if (!releaseDate) return null;
  const year = parseInt(releaseDate.slice(0, 4), 10);
  if (isNaN(year)) return null;
  const decade = Math.floor(year / 10) * 10;
  return `${decade}s`;
}
