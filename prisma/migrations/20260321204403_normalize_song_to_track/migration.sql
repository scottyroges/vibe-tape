/*
  Warnings:

  - You are about to drop the `song` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "song" DROP CONSTRAINT "song_user_id_fkey";

-- DropTable
DROP TABLE "song";

-- CreateTable
CREATE TABLE "track" (
    "id" TEXT NOT NULL,
    "spotify_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "artist" TEXT NOT NULL,
    "album" TEXT NOT NULL,
    "album_art_url" TEXT,
    "lastfm_genres" TEXT,
    "bpm" INTEGER,
    "era" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "track_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "liked_song" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "track_id" TEXT NOT NULL,
    "added_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "liked_song_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "track_spotify_id_key" ON "track"("spotify_id");

-- CreateIndex
CREATE INDEX "liked_song_user_id_idx" ON "liked_song"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "liked_song_user_id_track_id_key" ON "liked_song"("user_id", "track_id");

-- AddForeignKey
ALTER TABLE "liked_song" ADD CONSTRAINT "liked_song_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liked_song" ADD CONSTRAINT "liked_song_track_id_fkey" FOREIGN KEY ("track_id") REFERENCES "track"("id") ON DELETE CASCADE ON UPDATE CASCADE;
