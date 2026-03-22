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

Core fields: `spotifyId` (unique), `name`, `album`, `albumArtUrl`.

Vibe profile fields (derived from enrichment data, used for playlist generation):
- `vibeMood`, `vibeEnergy`, `vibeDanceability` — Summarized from Claude classification.
- `vibeGenres`, `vibeTags` — Merged genre/tag arrays from all enrichment sources.
- `vibeVersion` — Tracks which derivation logic produced the current vibe profile. Default 0.
- `vibeUpdatedAt` — When the vibe profile was last recomputed.

Source-specific enrichment data lives in separate tables (see Enrichment Tables below).

### Artist
A unique Spotify artist. Artists are shared across tracks — the same artist can appear on many tracks without duplicating metadata.

Fields: `spotifyId` (unique), `name`. Source-specific enrichment data lives in separate tables (see Enrichment Tables below).

### Enrichment Tables
Enrichment data is stored in per-source tables rather than as columns on Track/Artist. Each table has its own `version` and `enrichedAt` fields, allowing sources to be re-enriched independently. All use the parent entity's ID as their primary key (1:1 relationship) with `onDelete: Cascade`. Repository methods use upsert (`INSERT ... ON CONFLICT DO UPDATE`) to write enrichment data.

- **TrackSpotifyEnrichment** — `popularity`, `durationMs`, `releaseDate`, `derivedEra` (computed from release date).
- **TrackClaudeEnrichment** — `mood`, `energy`, `danceability`, `vibeTags`. Classified by Claude Haiku.
- **TrackLastfmEnrichment** — `tags` array from Last.fm.
- **ArtistSpotifyEnrichment** — `genres` array from the Spotify artist endpoint.
- **ArtistLastfmEnrichment** — `tags` array from Last.fm.

Version constants are defined per-source in `src/lib/enrichment.ts` (`SPOTIFY_ENRICHMENT_VERSION`, `CLAUDE_ENRICHMENT_VERSION`, `LASTFM_ENRICHMENT_VERSION`, `VIBE_DERIVATION_VERSION`).

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
