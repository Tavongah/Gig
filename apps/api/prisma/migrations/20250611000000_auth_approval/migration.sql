CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED');

ALTER TABLE "User" ADD COLUMN "passwordHash" TEXT;
ALTER TABLE "User" ADD COLUMN "accountStatus" "AccountStatus" NOT NULL DEFAULT 'ACTIVE';

UPDATE "User" SET "accountStatus" = 'APPROVED'
WHERE 'WORKER' = ANY("roles") AND EXISTS (SELECT 1 FROM "WorkerProfile" wp WHERE wp."userId" = "User".id);

UPDATE "User" SET "accountStatus" = 'PENDING_APPROVAL'
WHERE 'WORKER' = ANY("roles") AND "accountStatus" = 'ACTIVE' AND EXISTS (SELECT 1 FROM "WorkerProfile" wp WHERE wp."userId" = "User".id);

ALTER TABLE "WorkerProfile" ADD COLUMN "city" TEXT;
ALTER TABLE "WorkerProfile" ADD COLUMN "serviceArea" TEXT;
ALTER TABLE "WorkerProfile" ADD COLUMN "workExperience" TEXT;
ALTER TABLE "WorkerProfile" ADD COLUMN "governmentIdAcknowledged" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "WorkerProfile" ADD COLUMN "proofOfAddressAcknowledged" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "WorkerProfile" ADD COLUMN "platformRulesAgreed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "WorkerProfile" ADD COLUMN "reviewedAt" TIMESTAMP(3);
ALTER TABLE "WorkerProfile" ADD COLUMN "reviewedById" TEXT;
ALTER TABLE "WorkerProfile" ADD COLUMN "rejectionReason" TEXT;

CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
