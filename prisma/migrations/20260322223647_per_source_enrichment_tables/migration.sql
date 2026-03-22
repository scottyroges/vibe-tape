/*
  Warnings:

  - You are about to drop the column `enriched_at` on the `artist` table. All the data in the column will be lost.
  - You are about to drop the column `enrichment_version` on the `artist` table. All the data in the column will be lost.
  - You are about to drop the column `lastfm_tags` on the `artist` table. All the data in the column will be lost.
  - You are about to drop the column `spotify_genres` on the `artist` table. All the data in the column will be lost.
  - You are about to drop the column `claude_danceability` on the `track` table. All the data in the column will be lost.
  - You are about to drop the column `claude_energy` on the `track` table. All the data in the column will be lost.
  - You are about to drop the column `claude_mood` on the `track` table. All the data in the column will be lost.
  - You are about to drop the column `claude_vibe_tags` on the `track` table. All the data in the column will be lost.
  - You are about to drop the column `derived_era` on the `track` table. All the data in the column will be lost.
  - You are about to drop the column `enriched_at` on the `track` table. All the data in the column will be lost.
  - You are about to drop the column `enrichment_version` on the `track` table. All the data in the column will be lost.
  - You are about to drop the column `lastfm_tags` on the `track` table. All the data in the column will be lost.
  - You are about to drop the column `spotify_duration_ms` on the `track` table. All the data in the column will be lost.
  - You are about to drop the column `spotify_popularity` on the `track` table. All the data in the column will be lost.
  - You are about to drop the column `spotify_release_date` on the `track` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "artist" DROP COLUMN "enriched_at",
DROP COLUMN "enrichment_version",
DROP COLUMN "lastfm_tags",
DROP COLUMN "spotify_genres";

-- AlterTable
ALTER TABLE "track" DROP COLUMN "claude_danceability",
DROP COLUMN "claude_energy",
DROP COLUMN "claude_mood",
DROP COLUMN "claude_vibe_tags",
DROP COLUMN "derived_era",
DROP COLUMN "enriched_at",
DROP COLUMN "enrichment_version",
DROP COLUMN "lastfm_tags",
DROP COLUMN "spotify_duration_ms",
DROP COLUMN "spotify_popularity",
DROP COLUMN "spotify_release_date",
ADD COLUMN     "vibe_danceability" TEXT,
ADD COLUMN     "vibe_energy" TEXT,
ADD COLUMN     "vibe_genres" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "vibe_mood" TEXT,
ADD COLUMN     "vibe_tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "vibe_updated_at" TIMESTAMP(3),
ADD COLUMN     "vibe_version" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "track_spotify_enrichment" (
    "track_id" TEXT NOT NULL,
    "popularity" INTEGER,
    "duration_ms" INTEGER,
    "release_date" TEXT,
    "derived_era" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "enriched_at" TIMESTAMP(3),

    CONSTRAINT "track_spotify_enrichment_pkey" PRIMARY KEY ("track_id")
);

-- CreateTable
CREATE TABLE "track_claude_enrichment" (
    "track_id" TEXT NOT NULL,
    "mood" TEXT,
    "energy" TEXT,
    "danceability" TEXT,
    "vibe_tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "version" INTEGER NOT NULL DEFAULT 0,
    "enriched_at" TIMESTAMP(3),

    CONSTRAINT "track_claude_enrichment_pkey" PRIMARY KEY ("track_id")
);

-- CreateTable
CREATE TABLE "track_lastfm_enrichment" (
    "track_id" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "version" INTEGER NOT NULL DEFAULT 0,
    "enriched_at" TIMESTAMP(3),

    CONSTRAINT "track_lastfm_enrichment_pkey" PRIMARY KEY ("track_id")
);

-- CreateTable
CREATE TABLE "artist_spotify_enrichment" (
    "artist_id" TEXT NOT NULL,
    "genres" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "version" INTEGER NOT NULL DEFAULT 0,
    "enriched_at" TIMESTAMP(3),

    CONSTRAINT "artist_spotify_enrichment_pkey" PRIMARY KEY ("artist_id")
);

-- CreateTable
CREATE TABLE "artist_lastfm_enrichment" (
    "artist_id" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "version" INTEGER NOT NULL DEFAULT 0,
    "enriched_at" TIMESTAMP(3),

    CONSTRAINT "artist_lastfm_enrichment_pkey" PRIMARY KEY ("artist_id")
);

-- AddForeignKey
ALTER TABLE "track_spotify_enrichment" ADD CONSTRAINT "track_spotify_enrichment_track_id_fkey" FOREIGN KEY ("track_id") REFERENCES "track"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "track_claude_enrichment" ADD CONSTRAINT "track_claude_enrichment_track_id_fkey" FOREIGN KEY ("track_id") REFERENCES "track"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "track_lastfm_enrichment" ADD CONSTRAINT "track_lastfm_enrichment_track_id_fkey" FOREIGN KEY ("track_id") REFERENCES "track"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artist_spotify_enrichment" ADD CONSTRAINT "artist_spotify_enrichment_artist_id_fkey" FOREIGN KEY ("artist_id") REFERENCES "artist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artist_lastfm_enrichment" ADD CONSTRAINT "artist_lastfm_enrichment_artist_id_fkey" FOREIGN KEY ("artist_id") REFERENCES "artist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
