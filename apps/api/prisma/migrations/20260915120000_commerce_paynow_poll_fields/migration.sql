-- Paynow official test transport: merchant reference + poll URL persistence
ALTER TABLE "CommercePaymentAttempt" ADD COLUMN IF NOT EXISTS "merchantReference" TEXT;
ALTER TABLE "CommercePaymentAttempt" ADD COLUMN IF NOT EXISTS "paynowReference" TEXT;
ALTER TABLE "CommercePaymentAttempt" ADD COLUMN IF NOT EXISTS "pollUrl" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "CommercePaymentAttempt_merchantReference_key"
  ON "CommercePaymentAttempt"("merchantReference");
