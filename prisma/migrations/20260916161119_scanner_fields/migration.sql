-- AlterTable
ALTER TABLE "ScannerState" ADD COLUMN     "backoffUntil" TIMESTAMP(3),
ADD COLUMN     "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "skipUntil" JSONB;
