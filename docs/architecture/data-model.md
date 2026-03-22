# Data Model

## Entity Relationships

```
User
├── LikedSong (user↔track join table)
│   └── Track (one row per unique Spotify track)
│       ├── TrackArtist (track↔artist join, ordered by position)
│       │   └── Artist (one row per unique Spotify artist)
│       │       ├── ArtistSpotifyEnrichment (1:1, genres from Spotify)
│       │       └── ArtistLastfmEnrichment (1:1, tags from Last.fm)
│       ├── TrackSpotifyEnrichment (1:1, popularity/duration/era)
│       ├── TrackClaudeEnrichment (1:1, mood/energy/danceability/vibe tags)
│       └── TrackLastfmEnrichment (1:1, tags from Last.fm)
└── Playlist (generated vibe playlists)
    └── seedSongIds[] (references to Tracks that seeded this playlist)

Future:
├── GroupSession (multiple users pool libraries)
│   └── GuestPass (invite non-members)
```

## Models

### User
Better Auth user model extended with Spotify-specific fields. Owns Songs and Playlists.

Fields:
- `tier` — Controls feature access. Values: `FREE` (default, 250 song cap), `STANDARD` ($10/yr, all songs), `POWER` ($25/yr, higher limits).
- `songCount` — Cached count of liked songs. Updated on sync.
- `syncStatus` — Tracks library sync state. Values: `IDLE` (default), `SYNCING`, `FAILED`. Set atomically via `trySetSyncing()` to prevent concurrent syncs. Reset to `IDLE` on success or `FAILED` via Inngest's `onFailure` callback.
- `needsReauth` — Set to `true` when Spotify refresh token is revoked. User must re-authenticate on next login.
- `lastSyncedAt` — Timestamp of last successful library sync.

### Track
A unique Spotify track. Tracks are shared across users — multiple users can like the same track without duplicating metadata. Artists are linked via the TrackArtist join table rather than stored as a string column.

Fields:
- `spotifyId` — Spotify track ID. Globally unique (`@unique`).
- `spotifyPopularity` — Spotify popularity score (0-100), nullable.
- `spotifyDurationMs` — Track duration in milliseconds, nullable.
- `spotifyReleaseDate` — Album release date as string (e.g., "2024-01-01"), nullable.
- `derivedEra` — Decade/era classification, computed during enrichment.
- `claudeMood` — Single-word mood descriptor (e.g., "melancholic", "uplifting"), nullable. Classified by Claude Haiku during enrichment.
- `claudeEnergy` — Energy level: "low", "medium", or "high", nullable.
- `claudeDanceability` — Danceability level: "low", "medium", or "high", nullable.
- `claudeVibeTags` — Array of 2-5 short vibe descriptors (e.g., "late-night", "driving"). Defaults to empty array.
- `lastfmTags` — Array of tag strings from Last.fm (populated during enrichment).
- `enrichmentVersion` — Integer tracking which enrichment pipeline version last processed this track. Default 0 (unenriched).
- `enrichedAt` — Timestamp of last enrichment run.

### Artist
A unique Spotify artist. Artists are shared across tracks — the same artist can appear on many tracks without duplicating metadata. Like Track, Artist carries its own enrichment version for the enrichment pipeline.

Fields:
- `spotifyId` — Spotify artist ID. Globally unique (`@unique`).
- `name` — Display name from Spotify, updated on each sync.
- `spotifyGenres` — Array of genre strings from the Spotify artist endpoint (populated during enrichment).
- `lastfmTags` — Array of tag strings from Last.fm (populated during enrichment).
- `enrichmentVersion` — Integer tracking which enrichment pipeline version last processed this artist. Default 0.
- `enrichedAt` — Timestamp of last enrichment run.

### TrackArtist
Join table linking tracks to artists with ordering. A track's primary artist is at position 0, featured artists follow.

Fields:
- `trackId` — References Track.
- `artistId` — References Artist.
- `position` — Artist order (0-indexed). Used by `STRING_AGG(...ORDER BY position)` in the query layer to reconstruct a display string.
- Composite primary key on `(trackId, artistId)`.

### LikedSong
Join table linking users to tracks. Represents a user's liked song on Spotify.

Fields:
- `userId` — References User.
- `trackId` — References Track.
- `likedAt` — When the user liked the song on Spotify (used for incremental sync).
- Unique constraint on `(userId, trackId)`.

### Playlist
A generated vibe playlist. Links to Spotify via `spotifyPlaylistId`.

Fields:
- `vibeName` — AI-generated name (e.g., "Late Night Coastal Drive").
- `vibeDescription` — AI-generated one-line descriptor.
- `seedSongIds` — Array of Song IDs that seeded this playlist.
- `spotifyPlaylistId` — The Spotify playlist ID after creation.
- `artImageUrl` — URL to AI-generated art card in R2 (Tier 2).
- `lastSyncedAt` — Last time this playlist was refreshed against updated library.

### Account (Better Auth)
Stores Spotify OAuth tokens. Managed by Better Auth's `genericOAuth` plugin.

Key fields for Spotify integration:
- `accessToken` — Current Spotify access token (1-hour expiry).
- `refreshToken` — Long-lived refresh token (indefinite until revoked).
- `accessTokenExpiresAt` — Used by `getValidToken()` for lazy refresh.
- `providerId` — Always `"spotify"` for this app.

### Session (Better Auth)
Session management. Cookie-based, 30-day expiry.

### Verification (Better Auth)
Token verification for email flows (not used in MVP — Spotify OAuth only).

## Schema Conventions

- **Application model IDs** use `@default(cuid())` in the Prisma schema, but since the Prisma client is not used at runtime, repositories generate IDs via `@paralleldrive/cuid2`. Better Auth models use plain `String @id` with runtime-generated IDs.
- **Table names** use `@@map("snake_case")` for all models.
- **Column names** use `@map("snake_case")` in Prisma so the database is fully snake_case, while application code stays camelCase. Kysely's `CamelCasePlugin` handles the translation automatically.
- **Foreign keys** have `@@index` for query performance and `onDelete: Cascade` on parent relations.

## Query Layer

Schema and migrations are managed by Prisma (`schema.prisma` + `prisma migrate`). All repository queries are written in Kysely, a type-safe SQL query builder. Kysely database types are auto-generated from the Prisma schema via `prisma-kysely`.
