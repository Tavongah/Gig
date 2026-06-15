-- Payment lifecycle enum (API exposes snake_case: payment_pending, etc.)
CREATE TYPE "PaymentLifecycle" AS ENUM (
  'PAYMENT_PENDING',
  'PAYMENT_AUTHORIZED',
  'PAYMENT_CAPTURED',
  'PAYOUT_PENDING',
  'PAYOUT_PAID',
  'PAYMENT_FAILED'
);

ALTER TABLE "Gig" ADD COLUMN IF NOT EXISTS "paymentStatus" "PaymentLifecycle" NOT NULL DEFAULT 'PAYMENT_PENDING';
ALTER TABLE "Gig" ADD COLUMN IF NOT EXISTS "paymentIntentId" TEXT;
ALTER TABLE "Gig" ADD COLUMN IF NOT EXISTS "checkoutSessionId" TEXT;
ALTER TABLE "Gig" ADD COLUMN IF NOT EXISTS "assignedWorkerId" TEXT;

CREATE INDEX IF NOT EXISTS "Gig_paymentStatus_idx" ON "Gig"("paymentStatus");

ALTER TABLE "WorkerProfile" ADD COLUMN IF NOT EXISTS "stripeOnboardingComplete" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "WorkerProfile" ADD COLUMN IF NOT EXISTS "stripeChargesEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "WorkerProfile" ADD COLUMN IF NOT EXISTS "stripePayoutsEnabled" BOOLEAN NOT NULL DEFAULT false;

-- Rename stripeConnectedAccountId -> stripeAccountId when present
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'WorkerProfile' AND column_name = 'stripeConnectedAccountId'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'WorkerProfile' AND column_name = 'stripeAccountId'
  ) THEN
    ALTER TABLE "WorkerProfile" RENAME COLUMN "stripeConnectedAccountId" TO "stripeAccountId";
  END IF;
END $$;

ALTER TABLE "WorkerProfile" ADD COLUMN IF NOT EXISTS "stripeAccountId" TEXT;

-- Backfill gig paymentStatus from Payment rows
UPDATE "Gig" g
SET "paymentStatus" = CASE p.status
  WHEN 'REQUIRES_PAYMENT_METHOD' THEN 'PAYMENT_PENDING'::"PaymentLifecycle"
  WHEN 'AUTHORIZED' THEN 'PAYMENT_AUTHORIZED'::"PaymentLifecycle"
  WHEN 'CAPTURED' THEN 'PAYMENT_CAPTURED'::"PaymentLifecycle"
  WHEN 'PAYOUT_PENDING' THEN 'PAYOUT_PENDING'::"PaymentLifecycle"
  WHEN 'PAID_OUT' THEN 'PAYOUT_PAID'::"PaymentLifecycle"
  WHEN 'FAILED' THEN 'PAYMENT_FAILED'::"PaymentLifecycle"
  ELSE 'PAYMENT_PENDING'::"PaymentLifecycle"
END,
"paymentIntentId" = p."stripePaymentIntentId",
"checkoutSessionId" = p."stripeCheckoutSessionId"
FROM "Payment" p
WHERE p."gigId" = g.id;
