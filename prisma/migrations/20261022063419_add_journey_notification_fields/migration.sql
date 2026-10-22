-- AlterTable
ALTER TABLE "Journey" ADD COLUMN     "lastEscalationNotificationError" TEXT,
ADD COLUMN     "lastEscalationNotifiedAt" TIMESTAMP(3);
