-- DropIndex
DROP INDEX "Business_googlePlaceId_key";

-- DropIndex
DROP INDEX "Project_projectNumber_key";

-- CreateIndex
CREATE UNIQUE INDEX "Business_ownerId_googlePlaceId_key" ON "Business"("ownerId", "googlePlaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Project_ownerId_projectNumber_key" ON "Project"("ownerId", "projectNumber");
