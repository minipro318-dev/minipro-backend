-- CreateEnum
CREATE TYPE "GuardianInviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED', 'CANCELLED');

-- CreateTable
CREATE TABLE "GuardianInvite" (
    "id" SERIAL NOT NULL,
    "invitedById" INTEGER NOT NULL,
    "acceptedGuardianId" INTEGER,
    "guardianName" TEXT NOT NULL,
    "guardianEmail" TEXT NOT NULL,
    "guardianMobile" TEXT NOT NULL,
    "inviteCode" TEXT NOT NULL,
    "status" "GuardianInviteStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuardianInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GuardianInvite_inviteCode_key" ON "GuardianInvite"("inviteCode");

-- CreateIndex
CREATE INDEX "GuardianInvite_invitedById_status_idx" ON "GuardianInvite"("invitedById", "status");

-- CreateIndex
CREATE INDEX "GuardianInvite_guardianEmail_idx" ON "GuardianInvite"("guardianEmail");

-- CreateIndex
CREATE INDEX "GuardianInvite_guardianMobile_idx" ON "GuardianInvite"("guardianMobile");

-- AddForeignKey
ALTER TABLE "GuardianInvite" ADD CONSTRAINT "GuardianInvite_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuardianInvite" ADD CONSTRAINT "GuardianInvite_acceptedGuardianId_fkey" FOREIGN KEY ("acceptedGuardianId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
