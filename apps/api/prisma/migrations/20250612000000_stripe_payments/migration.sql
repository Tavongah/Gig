ALTER TYPE "PaymentStatus" ADD VALUE 'PAYOUT_PENDING';

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "stripeCustomerId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "User_stripeCustomerId_key" ON "User"("stripeCustomerId");

ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "stripeCheckoutSessionId" TEXT;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "stripeTransferId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Payment_stripeCheckoutSessionId_key" ON "Payment"("stripeCheckoutSessionId");
