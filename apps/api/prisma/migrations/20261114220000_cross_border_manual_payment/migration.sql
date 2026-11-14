-- Staff-attested ZB portal confirmation. Existing payment rows are unchanged.
ALTER TABLE "CrossBorderPayment" ADD COLUMN "confirmationMethod" TEXT;
ALTER TABLE "CrossBorderPayment" ADD COLUMN "externalOrderReference" TEXT;
ALTER TABLE "CrossBorderPayment" ADD COLUMN "confirmedById" TEXT;
ALTER TABLE "CrossBorderPayment" ADD COLUMN "portalConfirmedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "CrossBorderPayment_paid_provider_reference"
ON "CrossBorderPayment" ("providerReference")
WHERE "status" = 'PAID' AND "providerReference" IS NOT NULL;
