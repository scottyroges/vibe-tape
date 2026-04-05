-- CreateEnum
CREATE TYPE "PlaylistStatus" AS ENUM ('GENERATING', 'PENDING', 'SAVED', 'FAILED');

-- AlterTable
ALTER TABLE "playlist" ADD COLUMN     "claude_target" JSONB,
ADD COLUMN     "error_message" TEXT,
ADD COLUMN     "generated_track_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "math_target" JSONB,
ADD COLUMN     "status" "PlaylistStatus" NOT NULL DEFAULT 'GENERATING',
ADD COLUMN     "target_duration_minutes" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN     "user_intent" TEXT;
