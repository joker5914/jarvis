-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "candidates" JSONB,
ADD COLUMN     "candidatesAt" TIMESTAMP(3),
ADD COLUMN     "primaryPerson" TEXT,
ADD COLUMN     "suppressedApolloIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "apolloId" TEXT;
