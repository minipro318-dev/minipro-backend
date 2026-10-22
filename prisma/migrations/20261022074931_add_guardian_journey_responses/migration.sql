-- AlterEnum
ALTER TYPE "JourneyEventType" ADD VALUE 'GUARDIAN_RESPONSE_SENT';

-- CreateTable
CREATE TABLE "GuardianJourneyResponse" (
    "id" SERIAL NOT NULL,
    "journeyId" INTEGER NOT NULL,
    "incidentId" INTEGER,
    "guardianId" INTEGER NOT NULL,
    "endUserId" INTEGER NOT NULL,
    "message" TEXT NOT NULL,
    "messageTemplateKey" TEXT,
    "deliveredViaRealtime" BOOLEAN NOT NULL DEFAULT false,
    "deliveryError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuardianJourneyResponse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GuardianJourneyResponse_journeyId_createdAt_idx" ON "GuardianJourneyResponse"("journeyId", "createdAt");

-- CreateIndex
CREATE INDEX "GuardianJourneyResponse_incidentId_idx" ON "GuardianJourneyResponse"("incidentId");

-- CreateIndex
CREATE INDEX "GuardianJourneyResponse_guardianId_idx" ON "GuardianJourneyResponse"("guardianId");

-- CreateIndex
CREATE INDEX "GuardianJourneyResponse_endUserId_createdAt_idx" ON "GuardianJourneyResponse"("endUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "GuardianJourneyResponse" ADD CONSTRAINT "GuardianJourneyResponse_journeyId_fkey" FOREIGN KEY ("journeyId") REFERENCES "Journey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuardianJourneyResponse" ADD CONSTRAINT "GuardianJourneyResponse_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuardianJourneyResponse" ADD CONSTRAINT "GuardianJourneyResponse_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuardianJourneyResponse" ADD CONSTRAINT "GuardianJourneyResponse_endUserId_fkey" FOREIGN KEY ("endUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
