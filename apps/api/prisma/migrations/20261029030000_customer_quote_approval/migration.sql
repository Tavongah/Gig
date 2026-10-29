-- Customer acceptance of one snapshotted merchant quote.
-- Historical checkouts stay valid. The new status is not backfilled.

ALTER TYPE "CommerceCheckoutStatus" ADD VALUE IF NOT EXISTS 'CUSTOMER_APPROVED';

ALTER TABLE "CommerceCheckout" ADD COLUMN "approvedAt" TIMESTAMP(3);
