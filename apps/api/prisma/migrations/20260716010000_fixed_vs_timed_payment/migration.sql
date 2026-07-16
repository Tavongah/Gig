-- Fixed vs time-based payment authorization fields
ALTER TABLE "Gig"
  ADD COLUMN IF NOT EXISTS "authorizationBufferCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "maximumAuthorizedAmountCents" INTEGER,
  ADD COLUMN IF NOT EXISTS "billingIncrementMinutes" INTEGER NOT NULL DEFAULT 15;

ALTER TABLE "GigAssignment"
  ADD COLUMN IF NOT EXISTS "actualWorkedSeconds" INTEGER,
  ADD COLUMN IF NOT EXISTS "billableSeconds" INTEGER,
  ADD COLUMN IF NOT EXISTS "totalApprovedPausedSeconds" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Payment"
  ADD COLUMN IF NOT EXISTS "authorizationStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "authorizedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "captureBefore" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "capturedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "maximumAuthorizedAmountCents" INTEGER;
