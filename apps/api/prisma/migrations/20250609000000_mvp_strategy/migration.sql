-- CreateEnum
CREATE TYPE "LaunchPhase" AS ENUM ('MVP', 'PHASE_2');

-- AlterTable
ALTER TABLE "ServiceCategory" ADD COLUMN "launchPhase" "LaunchPhase" NOT NULL DEFAULT 'MVP';

-- AlterTable
ALTER TABLE "WorkerProfile" ADD COLUMN "travelDistanceMiles" DECIMAL(5,2) NOT NULL DEFAULT 10;
ALTER TABLE "WorkerProfile" ADD COLUMN "hourlyRateCents" INTEGER;
ALTER TABLE "WorkerProfile" ADD COLUMN "minJobAmountCents" INTEGER NOT NULL DEFAULT 5000;
