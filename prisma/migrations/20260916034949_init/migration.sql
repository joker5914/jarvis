-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('queued', 'running', 'paused', 'complete', 'failed');

-- CreateEnum
CREATE TYPE "BusinessSource" AS ENUM ('zip_search', 'tdlr', 'manual');

-- CreateEnum
CREATE TYPE "Exclusion" AS ENUM ('none', 'enterprise');

-- CreateEnum
CREATE TYPE "QualityBand" AS ENUM ('green', 'yellow', 'red');

-- CreateEnum
CREATE TYPE "OutreachStatus" AS ENUM ('not_contacted', 'contacted', 'interested', 'not_a_fit', 'customer');

-- CreateEnum
CREATE TYPE "ContactType" AS ENUM ('email', 'phone', 'linkedin', 'facebook', 'instagram', 'twitter', 'yelp', 'other');

-- CreateEnum
CREATE TYPE "ContactSource" AS ENUM ('google', 'website', 'apollo', 'tdlr', 'manual');

-- CreateEnum
CREATE TYPE "ValidationStatus" AS ENUM ('unchecked', 'valid', 'invalid', 'unreachable');

-- CreateEnum
CREATE TYPE "WorkType" AS ENUM ('new_construction', 'renovation', 'addition', 'historic', 'row');

-- CreateEnum
CREATE TYPE "TimingWindow" AS ENUM ('opening_soon', 'under_construction', 'planned', 'just_completed', 'stale');

-- CreateEnum
CREATE TYPE "ScannerStatus" AS ENUM ('idle', 'running', 'paused', 'outside_window', 'budget_exhausted', 'disabled');

-- CreateTable
CREATE TABLE "Search" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL DEFAULT 'local-user',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "zip" TEXT NOT NULL,
    "city" TEXT,
    "state" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "radiusMeters" INTEGER,
    "status" "JobStatus" NOT NULL DEFAULT 'queued',
    "progress" JSONB,
    "countsFound" INTEGER NOT NULL DEFAULT 0,
    "countsScraped" INTEGER NOT NULL DEFAULT 0,
    "countsEnriched" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "origin" TEXT NOT NULL DEFAULT 'manual',

    CONSTRAINT "Search_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Business" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL DEFAULT 'local-user',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "googlePlaceId" TEXT,
    "name" TEXT NOT NULL,
    "formattedAddress" TEXT,
    "zip" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "phone" TEXT,
    "websiteUrl" TEXT,
    "googleRating" DOUBLE PRECISION,
    "googleReviewCount" INTEGER,
    "googleTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "primaryCategory" TEXT,
    "source" "BusinessSource" NOT NULL DEFAULT 'zip_search',
    "exclusion" "Exclusion" NOT NULL DEFAULT 'none',
    "exclusionReasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "smbFitScore" INTEGER NOT NULL DEFAULT 0,
    "contactQualityScore" INTEGER NOT NULL DEFAULT 0,
    "contactQualityBand" "QualityBand" NOT NULL DEFAULT 'red',
    "contactQualityReasons" JSONB,
    "suggestedPackage" TEXT,
    "currentProviderHint" TEXT,
    "currentProviderEvidence" TEXT,
    "outreachStatus" "OutreachStatus" NOT NULL DEFAULT 'not_contacted',
    "productsPitched" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT NOT NULL DEFAULT '',
    "websiteReachable" BOOLEAN,
    "websiteCheckedAt" TIMESTAMP(3),
    "websiteError" TEXT,
    "lastEnrichedAt" TIMESTAMP(3),

    CONSTRAINT "Business_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchBusiness" (
    "searchId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "surfacedByCategory" TEXT NOT NULL,

    CONSTRAINT "SearchBusiness_pkey" PRIMARY KEY ("searchId","businessId")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL DEFAULT 'local-user',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "businessId" TEXT NOT NULL,
    "type" "ContactType" NOT NULL,
    "value" TEXT NOT NULL,
    "personName" TEXT,
    "personTitle" TEXT,
    "source" "ContactSource" NOT NULL,
    "validationStatus" "ValidationStatus" NOT NULL DEFAULT 'unchecked',
    "validatedAt" TIMESTAMP(3),

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL DEFAULT 'local-user',
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#64748b',
    "isSystem" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessTag" (
    "businessId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "BusinessTag_pkey" PRIMARY KEY ("businessId","tagId")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL DEFAULT 'local-user',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tdlrProjectId" TEXT,
    "projectNumber" TEXT NOT NULL,
    "projectName" TEXT NOT NULL,
    "facilityName" TEXT,
    "locationAddress" TEXT,
    "city" TEXT,
    "zip" TEXT,
    "county" TEXT,
    "statusCode" INTEGER,
    "statusLabel" TEXT,
    "workType" "WorkType",
    "estimatedCost" DOUBLE PRECISION,
    "squareFootage" INTEGER,
    "tenantFunded" BOOLEAN,
    "fundsType" TEXT,
    "scopeOfWork" TEXT,
    "startDate" TIMESTAMP(3),
    "completionDate" TIMESTAMP(3),
    "registrationDate" TIMESTAMP(3),
    "ownerName" TEXT,
    "ownerAddress" TEXT,
    "ownerPhone" TEXT,
    "contactName" TEXT,
    "tenantName" TEXT,
    "designFirmName" TEXT,
    "rasName" TEXT,
    "rasPhone" TEXT,
    "smbFitScore" INTEGER NOT NULL DEFAULT 0,
    "smbFitReasons" JSONB,
    "exclusion" "Exclusion" NOT NULL DEFAULT 'none',
    "exclusionReasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "timingWindow" "TimingWindow",
    "businessId" TEXT,
    "detailFetchedAt" TIMESTAMP(3),
    "lastCheckedAt" TIMESTAMP(3),
    "parseError" TEXT,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderConfig" (
    "provider" TEXT NOT NULL,
    "encryptedKey" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "dailyBudget" INTEGER NOT NULL DEFAULT 1000,
    "usedToday" INTEGER NOT NULL DEFAULT 0,
    "usageDate" TEXT,

    CONSTRAINT "ProviderConfig_pkey" PRIMARY KEY ("provider")
);

-- CreateTable
CREATE TABLE "SyncState" (
    "key" TEXT NOT NULL,
    "lastSuccessfulAt" TIMESTAMP(3),
    "cursor" JSONB,

    CONSTRAINT "SyncState_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL DEFAULT 'local-user',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "businessId" TEXT,
    "projectId" TEXT,
    "kind" TEXT NOT NULL,
    "message" TEXT NOT NULL,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScanSchedule" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL DEFAULT 'local-user',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "windowStart" TIMESTAMP(3),
    "windowEnd" TIMESTAMP(3),
    "dailyStartTime" TEXT,
    "dailyEndTime" TEXT,
    "daysOfWeek" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "timezone" TEXT NOT NULL DEFAULT 'America/Chicago',
    "zipRefreshDays" INTEGER NOT NULL DEFAULT 7,
    "tdlrSyncHours" INTEGER NOT NULL DEFAULT 6,
    "websiteRecheckDays" INTEGER NOT NULL DEFAULT 30,
    "autoAddHotZips" BOOLEAN NOT NULL DEFAULT true,
    "maxConcurrentJobs" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ScanSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScanTarget" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL DEFAULT 'local-user',
    "zip" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "addedBy" TEXT NOT NULL DEFAULT 'user',
    "lastSearchedAt" TIMESTAMP(3),
    "lastSearchId" TEXT,
    "paused" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ScanTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScannerState" (
    "ownerId" TEXT NOT NULL DEFAULT 'local-user',
    "status" "ScannerStatus" NOT NULL DEFAULT 'disabled',
    "pauseRequested" BOOLEAN NOT NULL DEFAULT false,
    "currentJobId" TEXT,
    "currentActivity" TEXT,
    "lastTickAt" TIMESTAMP(3),
    "nextPlanned" JSONB,
    "lastError" TEXT,

    CONSTRAINT "ScannerState_pkey" PRIMARY KEY ("ownerId")
);

-- CreateIndex
CREATE INDEX "Search_ownerId_createdAt_idx" ON "Search"("ownerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Business_googlePlaceId_key" ON "Business"("googlePlaceId");

-- CreateIndex
CREATE INDEX "Business_ownerId_zip_idx" ON "Business"("ownerId", "zip");

-- CreateIndex
CREATE INDEX "Business_ownerId_outreachStatus_idx" ON "Business"("ownerId", "outreachStatus");

-- CreateIndex
CREATE INDEX "Business_ownerId_contactQualityBand_idx" ON "Business"("ownerId", "contactQualityBand");

-- CreateIndex
CREATE INDEX "SearchBusiness_businessId_idx" ON "SearchBusiness"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_businessId_type_value_key" ON "Contact"("businessId", "type", "value");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_ownerId_name_key" ON "Tag"("ownerId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Project_projectNumber_key" ON "Project"("projectNumber");

-- CreateIndex
CREATE INDEX "Project_ownerId_completionDate_idx" ON "Project"("ownerId", "completionDate");

-- CreateIndex
CREATE INDEX "Project_ownerId_smbFitScore_idx" ON "Project"("ownerId", "smbFitScore");

-- CreateIndex
CREATE INDEX "ActivityLog_businessId_createdAt_idx" ON "ActivityLog"("businessId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ScanSchedule_ownerId_key" ON "ScanSchedule"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "ScanTarget_ownerId_zip_key" ON "ScanTarget"("ownerId", "zip");

-- AddForeignKey
ALTER TABLE "SearchBusiness" ADD CONSTRAINT "SearchBusiness_searchId_fkey" FOREIGN KEY ("searchId") REFERENCES "Search"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchBusiness" ADD CONSTRAINT "SearchBusiness_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessTag" ADD CONSTRAINT "BusinessTag_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessTag" ADD CONSTRAINT "BusinessTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
