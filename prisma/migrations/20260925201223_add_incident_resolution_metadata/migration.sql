-- CreateEnum
CREATE TYPE "IncidentResolvedBy" AS ENUM ('USER', 'GUARDIAN', 'ADMIN');

-- AlterTable
ALTER TABLE "Incident" ADD COLUMN     "resolutionNote" TEXT,
ADD COLUMN     "resolvedByRole" "IncidentResolvedBy";
