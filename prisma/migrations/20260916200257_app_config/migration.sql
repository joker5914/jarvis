-- CreateTable
CREATE TABLE "AppConfig" (
    "ownerId" TEXT NOT NULL,
    "overrides" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppConfig_pkey" PRIMARY KEY ("ownerId")
);
