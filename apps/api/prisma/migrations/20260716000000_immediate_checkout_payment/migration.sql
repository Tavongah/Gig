-- Immediate Checkout capture fields + partial refund status
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'PARTIALLY_REFUNDED';

ALTER TABLE "Payment"
  ADD COLUMN IF NOT EXISTS "stripeChargeId" TEXT,
  ADD COLUMN IF NOT EXISTS "stripeRefundId" TEXT,
  ADD COLUMN IF NOT EXISTS "refundAmountCents" INTEGER NOT NULL DEFAULT 0;
