-- AlterTable
ALTER TABLE "AiSafetyEvent" ADD COLUMN     "notificationError" TEXT,
ADD COLUMN     "notifiedAt" TIMESTAMP(3);
