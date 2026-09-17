-- AlterTable
ALTER TABLE "Search" ADD COLUMN     "categoriesDone" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "discoveryComplete" BOOLEAN NOT NULL DEFAULT true;
