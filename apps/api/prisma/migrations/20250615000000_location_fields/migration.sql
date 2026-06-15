-- AlterTable
ALTER TABLE "Gig" ADD COLUMN "formattedAddress" TEXT;

-- AlterTable
ALTER TABLE "WorkerProfile" ADD COLUMN "formattedAddress" TEXT;
ALTER TABLE "WorkerProfile" ADD COLUMN "locationUpdatedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "WorkerProfile_currentLatitude_currentLongitude_idx" ON "WorkerProfile"("currentLatitude", "currentLongitude");
