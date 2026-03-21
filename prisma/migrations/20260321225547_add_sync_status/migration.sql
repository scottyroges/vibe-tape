-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('IDLE', 'SYNCING', 'FAILED');

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "sync_status" "SyncStatus" NOT NULL DEFAULT 'IDLE';
