-- Stage 2.5: PIN attempt locks + explicit delivery courier eligibility

ALTER TABLE "Gig" ADD COLUMN IF NOT EXISTS "pickupPinFailCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Gig" ADD COLUMN IF NOT EXISTS "deliveryPinFailCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Gig" ADD COLUMN IF NOT EXISTS "pickupPinLockedUntil" TIMESTAMP(3);
ALTER TABLE "Gig" ADD COLUMN IF NOT EXISTS "deliveryPinLockedUntil" TIMESTAMP(3);

ALTER TABLE "WorkerProfile" ADD COLUMN IF NOT EXISTS "deliveryEligible" BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN "Gig"."pickupPin" IS 'Hashed pickup verification PIN (plaintext never retained after create/regenerate response).';
COMMENT ON COLUMN "Gig"."deliveryPin" IS 'Hashed delivery verification PIN (plaintext never retained after create/regenerate response).';
COMMENT ON COLUMN "WorkerProfile"."deliveryEligible" IS 'Courier opted into DUTS Delivery matching (parcel-delivery + Phase-1 transport).';
