-- Stage 4.5: commerce payment method + merchant timeout
DO $$ BEGIN
  CREATE TYPE "CommercePaymentMethod" AS ENUM ('TEST_BYPASS', 'CASH', 'STRIPE', 'ECOCASH', 'ONEMONEY');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TYPE "CommercePaymentStatus" ADD VALUE 'DUE_ON_DELIVERY';
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "CommerceOrder" ADD COLUMN IF NOT EXISTS "paymentMethod" "CommercePaymentMethod" NOT NULL DEFAULT 'CASH';
ALTER TABLE "CommerceOrder" ADD COLUMN IF NOT EXISTS "merchantRespondBy" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "CommerceOrder_status_merchantRespondBy_idx"
  ON "CommerceOrder"("status", "merchantRespondBy");
