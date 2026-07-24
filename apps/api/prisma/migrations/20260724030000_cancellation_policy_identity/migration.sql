-- AlterEnum
ALTER TYPE "WorkerEarningsTransactionType" ADD VALUE 'CANCELLATION_FEE_CREDIT';

-- AlterTable
ALTER TABLE "Gig" ADD COLUMN "travelStartedAt" TIMESTAMP(3),
ADD COLUMN "cancellationGraceEndsAt" TIMESTAMP(3),
ADD COLUMN "cancelledAt" TIMESTAMP(3),
ADD COLUMN "cancellationFeeCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "cancellationFeePaid" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "cancellationReason" TEXT,
ADD COLUMN "cancelledBy" TEXT,
ADD COLUMN "travelDurationSeconds" INTEGER;

-- AlterTable
ALTER TABLE "WorkerProfile" ADD COLUMN "governmentIdType" TEXT,
ADD COLUMN "governmentIdFrontKey" TEXT,
ADD COLUMN "governmentIdBackKey" TEXT,
ADD COLUMN "identityVerificationStatus" TEXT NOT NULL DEFAULT 'PENDING',
ADD COLUMN "identityDocumentsUploadedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PlatformSetting" (
    "id" TEXT NOT NULL,
    "cancellationFeePercent" DECIMAL(4,3) NOT NULL DEFAULT 0.25,
    "cancellationGraceMinutes" INTEGER NOT NULL DEFAULT 5,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformSetting_pkey" PRIMARY KEY ("id")
);

INSERT INTO "PlatformSetting" ("id", "cancellationFeePercent", "cancellationGraceMinutes", "updatedAt", "createdAt")
VALUES ('default', 0.25, 5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
