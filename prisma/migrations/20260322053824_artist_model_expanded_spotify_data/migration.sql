-- Destructive migration: drop and recreate track/liked_song tables.
-- This is safe because this is a solo dev project with only dev data.
-- Existing tracks will be re-synced from Spotify on next library sync.

-- Drop dependents first (FK constraints)
DROP TABLE IF EXISTS "liked_song";
DROP TABLE IF EXISTS "track";

-- CreateTable
CREATE TABLE "track" (
    "id" TEXT NOT NULL,
    "spotify_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "album" TEXT NOT NULL,
    "album_art_url" TEXT,
    "spotify_popularity" INTEGER,
    "spotify_duration_ms" INTEGER,
    "spotify_release_date" TEXT,
    "derived_era" TEXT,
    "lastfm_tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "enrichment_version" INTEGER NOT NULL DEFAULT 0,
    "enriched_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "track_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "artist" (
    "id" TEXT NOT NULL,
    "spotify_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "spotify_genres" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastfm_tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "enrichment_version" INTEGER NOT NULL DEFAULT 0,
    "enriched_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "artist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "track_artist" (
    "track_id" TEXT NOT NULL,
    "artist_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "track_artist_pkey" PRIMARY KEY ("track_id","artist_id")
);

-- CreateTable
CREATE TABLE "liked_song" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "track_id" TEXT NOT NULL,
    "liked_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "liked_song_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "track_spotify_id_key" ON "track"("spotify_id");

-- CreateIndex
CREATE UNIQUE INDEX "artist_spotify_id_key" ON "artist"("spotify_id");

-- CreateIndex
CREATE INDEX "track_artist_artist_id_idx" ON "track_artist"("artist_id");

-- CreateIndex
CREATE UNIQUE INDEX "liked_song_user_id_track_id_key" ON "liked_song"("user_id","track_id");

-- CreateIndex
CREATE INDEX "liked_song_user_id_idx" ON "liked_song"("user_id");

-- AddForeignKey
ALTER TABLE "track_artist" ADD CONSTRAINT "track_artist_track_id_fkey" FOREIGN KEY ("track_id") REFERENCES "track"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "track_artist" ADD CONSTRAINT "track_artist_artist_id_fkey" FOREIGN KEY ("artist_id") REFERENCES "artist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liked_song" ADD CONSTRAINT "liked_song_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liked_song" ADD CONSTRAINT "liked_song_track_id_fkey" FOREIGN KEY ("track_id") REFERENCES "track"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Reset song counts since all track data was wiped
UPDATE "user" SET "song_count" = 0, "sync_status" = 'IDLE', "last_synced_at" = NULL;
