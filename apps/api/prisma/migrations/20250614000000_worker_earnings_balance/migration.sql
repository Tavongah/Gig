-- CreateEnum
CREATE TYPE "WorkerEarningsTransactionType" AS ENUM ('GIG_COMPLETED_CREDIT', 'WITHDRAWAL_REQUESTED', 'WITHDRAWAL_SUCCESS', 'WITHDRAWAL_FAILED');

-- CreateEnum
CREATE TYPE "WorkerEarningsTransactionStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- AlterTable
ALTER TABLE "WorkerProfile" ADD COLUMN "availableBalanceCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "WorkerProfile" ADD COLUMN "withdrawnBalanceCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "WorkerProfile" ADD COLUMN "totalEarnedCents" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "WorkerEarningsTransaction" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "gigId" TEXT,
    "type" "WorkerEarningsTransactionType" NOT NULL,
    "status" "WorkerEarningsTransactionStatus" NOT NULL DEFAULT 'PENDING',
    "amountCents" INTEGER NOT NULL,
    "stripeTransferId" TEXT,
    "failureReason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkerEarningsTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkerEarningsTransaction_workerId_createdAt_idx" ON "WorkerEarningsTransaction"("workerId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkerEarningsTransaction_gigId_type_idx" ON "WorkerEarningsTransaction"("gigId", "type");

-- AddForeignKey
ALTER TABLE "WorkerEarningsTransaction" ADD CONSTRAINT "WorkerEarningsTransaction_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerEarningsTransaction" ADD CONSTRAINT "WorkerEarningsTransaction_gigId_fkey" FOREIGN KEY ("gigId") REFERENCES "Gig"("id") ON DELETE SET NULL ON UPDATE CASCADE;
