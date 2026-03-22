-- AlterTable
ALTER TABLE "track" ADD COLUMN     "claude_danceability" TEXT,
ADD COLUMN     "claude_energy" TEXT,
ADD COLUMN     "claude_mood" TEXT,
ADD COLUMN     "claude_vibe_tags" TEXT[] DEFAULT ARRAY[]::TEXT[];
