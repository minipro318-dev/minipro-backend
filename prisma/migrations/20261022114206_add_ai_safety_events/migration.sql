-- CreateEnum
CREATE TYPE "AiSafetyEventStatus" AS ENUM ('DETECTED', 'AWAITING_CONFIRMATION', 'ACKNOWLEDGED', 'FALSE_ALARM', 'ESCALATED', 'EXPIRED', 'CANCELLED');

-- CreateTable
CREATE TABLE "AiSafetyEvent" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "eventType" TEXT NOT NULL DEFAULT 'POSSIBLE_FALL',
    "status" "AiSafetyEventStatus" NOT NULL DEFAULT 'DETECTED',
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modelProvider" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "classifierType" TEXT NOT NULL DEFAULT 'POSE_HEURISTIC',
    "classifierScore" DOUBLE PRECISION,
    "classifierConfidence" DOUBLE PRECISION,
    "confidenceLabel" TEXT,
    "confirmationDeadline" TIMESTAMP(3),
    "userResponse" TEXT,
    "responseReason" TEXT,
    "respondedAt" TIMESTAMP(3),
    "linkedIncidentId" INTEGER,
    "escalationReason" TEXT,
    "escalatedAt" TIMESTAMP(3),
    "escalatedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiSafetyEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiSafetyEvent_userId_status_detectedAt_idx" ON "AiSafetyEvent"("userId", "status", "detectedAt");

-- CreateIndex
CREATE INDEX "AiSafetyEvent_status_confirmationDeadline_idx" ON "AiSafetyEvent"("status", "confirmationDeadline");

-- CreateIndex
CREATE INDEX "AiSafetyEvent_linkedIncidentId_idx" ON "AiSafetyEvent"("linkedIncidentId");

-- CreateIndex
CREATE INDEX "AiSafetyEvent_detectedAt_idx" ON "AiSafetyEvent"("detectedAt");

-- AddForeignKey
ALTER TABLE "AiSafetyEvent" ADD CONSTRAINT "AiSafetyEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiSafetyEvent" ADD CONSTRAINT "AiSafetyEvent_linkedIncidentId_fkey" FOREIGN KEY ("linkedIncidentId") REFERENCES "Incident"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiSafetyEvent" ADD CONSTRAINT "AiSafetyEvent_escalatedById_fkey" FOREIGN KEY ("escalatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
