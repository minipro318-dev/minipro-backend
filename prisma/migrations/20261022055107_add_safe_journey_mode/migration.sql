-- CreateEnum
CREATE TYPE "JourneyStatus" AS ENUM ('PLANNED', 'ACTIVE', 'CHECK_IN_REQUIRED', 'COMPLETED', 'CANCELLED', 'ESCALATED');

-- CreateEnum
CREATE TYPE "JourneyEventType" AS ENUM ('JOURNEY_CREATED', 'JOURNEY_STARTED', 'LOCATION_RECORDED', 'DEVIATION_DETECTED', 'CHECK_IN_REQUIRED', 'SAFETY_CONFIRMED', 'JOURNEY_COMPLETED', 'JOURNEY_CANCELLED', 'ESCALATED_TO_SOS');

-- CreateTable
CREATE TABLE "Journey" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'Safe Journey',
    "destinationName" TEXT NOT NULL,
    "destinationLatitude" DOUBLE PRECISION NOT NULL,
    "destinationLongitude" DOUBLE PRECISION NOT NULL,
    "status" "JourneyStatus" NOT NULL DEFAULT 'PLANNED',
    "plannedById" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "expectedArrivalAt" TIMESTAMP(3),
    "routePolyline" TEXT,
    "routeDistanceMeters" INTEGER,
    "routeDurationSeconds" INTEGER,
    "currentLatitude" DOUBLE PRECISION,
    "currentLongitude" DOUBLE PRECISION,
    "currentAccuracy" DOUBLE PRECISION,
    "currentAddress" TEXT,
    "currentLocationAt" TIMESTAMP(3),
    "offRouteCount" INTEGER NOT NULL DEFAULT 0,
    "checkInReason" TEXT,
    "checkInRequiredAt" TIMESTAMP(3),
    "checkInExpiresAt" TIMESTAMP(3),
    "checkInAcknowledgedAt" TIMESTAMP(3),
    "escalatedAt" TIMESTAMP(3),
    "escalationIncidentId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Journey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JourneyLocation" (
    "id" SERIAL NOT NULL,
    "journeyId" INTEGER NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "accuracy" DOUBLE PRECISION,
    "address" TEXT,
    "locationTimestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL DEFAULT 'USER_UPDATE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JourneyLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JourneyEvent" (
    "id" SERIAL NOT NULL,
    "journeyId" INTEGER NOT NULL,
    "eventType" "JourneyEventType" NOT NULL,
    "message" TEXT NOT NULL,
    "actorRole" "UserRole",
    "actorId" INTEGER,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JourneyEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Journey_plannedById_status_idx" ON "Journey"("plannedById", "status");

-- CreateIndex
CREATE INDEX "Journey_status_checkInExpiresAt_idx" ON "Journey"("status", "checkInExpiresAt");

-- CreateIndex
CREATE INDEX "Journey_escalationIncidentId_idx" ON "Journey"("escalationIncidentId");

-- CreateIndex
CREATE INDEX "Journey_createdAt_idx" ON "Journey"("createdAt");

-- CreateIndex
CREATE INDEX "JourneyLocation_journeyId_createdAt_idx" ON "JourneyLocation"("journeyId", "createdAt");

-- CreateIndex
CREATE INDEX "JourneyEvent_journeyId_createdAt_idx" ON "JourneyEvent"("journeyId", "createdAt");

-- CreateIndex
CREATE INDEX "JourneyEvent_eventType_idx" ON "JourneyEvent"("eventType");

-- AddForeignKey
ALTER TABLE "Journey" ADD CONSTRAINT "Journey_plannedById_fkey" FOREIGN KEY ("plannedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Journey" ADD CONSTRAINT "Journey_escalationIncidentId_fkey" FOREIGN KEY ("escalationIncidentId") REFERENCES "Incident"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JourneyLocation" ADD CONSTRAINT "JourneyLocation_journeyId_fkey" FOREIGN KEY ("journeyId") REFERENCES "Journey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JourneyEvent" ADD CONSTRAINT "JourneyEvent_journeyId_fkey" FOREIGN KEY ("journeyId") REFERENCES "Journey"("id") ON DELETE CASCADE ON UPDATE CASCADE;
