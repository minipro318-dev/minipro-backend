-- AlterTable
ALTER TABLE "AiSafetyEvent" ADD COLUMN     "lastKnownAccuracy" DOUBLE PRECISION,
ADD COLUMN     "lastKnownAddress" TEXT,
ADD COLUMN     "lastKnownLatitude" DOUBLE PRECISION,
ADD COLUMN     "lastKnownLongitude" DOUBLE PRECISION;
