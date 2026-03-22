export const CURRENT_ENRICHMENT_VERSION = 1;

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
