# Data Model

## Entity Relationships

```
User
├── LikedSong (user↔track join table)
│   └── Track (one row per unique Spotify track)
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
- `needsReauth` — Set to `true` when Spotify refresh token is revoked. User must re-authenticate on next login.
- `lastSyncedAt` — Timestamp of last successful library sync.

### Track
A unique Spotify track. Tracks are shared across users — multiple users can like the same track without duplicating metadata. Enriched with Last.fm metadata (Tier 2).

Fields:
- `spotifyId` — Spotify track ID. Globally unique (`@unique`).
- `lastfmGenres` — Comma-separated genre tags from Last.fm (Tier 2).
- `bpm` — Beats per minute from MusicBrainz (Tier 2).
- `era` — Decade/era classification (Tier 2).

### LikedSong
Join table linking users to tracks. Represents a user's liked song on Spotify.

Fields:
- `userId` — References User.
- `trackId` — References Track.
- `addedAt` — When the user liked the song on Spotify (used for incremental sync).
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
