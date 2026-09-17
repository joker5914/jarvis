-- AlterTable
ALTER TABLE "ProviderConfig" ADD COLUMN     "planBlockDetail" TEXT,
ADD COLUMN     "planBlockedUntil" TIMESTAMP(3);
