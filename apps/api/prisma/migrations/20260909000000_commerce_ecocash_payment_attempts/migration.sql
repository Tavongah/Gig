-- EcoCash / commerce payment attempts (Stage payment rail).
-- Adds PAYMENT_PENDING + PAID statuses and CommercePaymentAttempt.

ALTER TYPE "CommercePaymentStatus" ADD VALUE IF NOT EXISTS 'PAYMENT_PENDING';
ALTER TYPE "CommercePaymentStatus" ADD VALUE IF NOT EXISTS 'PAID';
ALTER TYPE "CommercePaymentStatus" ADD VALUE IF NOT EXISTS 'PAYMENT_FAILED';

DO $$ BEGIN
  CREATE TYPE "CommercePaymentAttemptStatus" AS ENUM (
    'CREATED',
    'PENDING',
    'PAID',
    'FAILED',
    'EXPIRED',
    'CANCELLED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "CommercePaymentAttempt" (
  "id" TEXT NOT NULL,
  "commerceOrderId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "providerPaymentId" TEXT,
  "payerPhone" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'usd',
  "status" "CommercePaymentAttemptStatus" NOT NULL DEFAULT 'CREATED',
  "failureReason" TEXT,
  "initiatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  "confirmedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CommercePaymentAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CommercePaymentAttempt_provider_providerPaymentId_key"
  ON "CommercePaymentAttempt"("provider", "providerPaymentId");

CREATE INDEX IF NOT EXISTS "CommercePaymentAttempt_commerceOrderId_status_idx"
  ON "CommercePaymentAttempt"("commerceOrderId", "status");

CREATE INDEX IF NOT EXISTS "CommercePaymentAttempt_status_expiresAt_idx"
  ON "CommercePaymentAttempt"("status", "expiresAt");

DO $$ BEGIN
  ALTER TABLE "CommercePaymentAttempt"
    ADD CONSTRAINT "CommercePaymentAttempt_commerceOrderId_fkey"
    FOREIGN KEY ("commerceOrderId") REFERENCES "CommerceOrder"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
