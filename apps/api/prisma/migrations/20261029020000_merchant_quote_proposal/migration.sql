-- Additive merchant quote proposal for unresolved supported-city checkouts.
-- Historical rows keep quoteVersion 0, null proposal fields, and validationFixture false.
-- Fixture backfill runs only when checkout number, exact note, and validation customer all match.

ALTER TYPE "CommerceCheckoutStatus" ADD VALUE IF NOT EXISTS 'PRICE_PROPOSED';

ALTER TABLE "CommerceCheckout" ADD COLUMN "quoteVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CommerceCheckout" ADD COLUMN "approvalId" TEXT;
ALTER TABLE "CommerceCheckout" ADD COLUMN "quoteExpiresAt" TIMESTAMP(3);
ALTER TABLE "CommerceCheckout" ADD COLUMN "validationFixture" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "CommerceCheckoutLine" ADD COLUMN "sourceProductId" TEXT;
ALTER TABLE "CommerceCheckoutLine" ADD COLUMN "sourceMerchantId" TEXT;
ALTER TABLE "CommerceCheckoutLine" ADD COLUMN "quotedAt" TIMESTAMP(3);

CREATE INDEX "CommerceCheckout_validationFixture_status_idx"
  ON "CommerceCheckout"("validationFixture", "status");
CREATE INDEX "CommerceCheckoutLine_sourceProductId_idx"
  ON "CommerceCheckoutLine"("sourceProductId");
CREATE INDEX "CommerceCheckoutLine_sourceMerchantId_idx"
  ON "CommerceCheckoutLine"("sourceMerchantId");

ALTER TABLE "CommerceCheckoutLine"
  ADD CONSTRAINT "CommerceCheckoutLine_sourceProductId_fkey"
  FOREIGN KEY ("sourceProductId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CommerceCheckoutLine"
  ADD CONSTRAINT "CommerceCheckoutLine_sourceMerchantId_fkey"
  FOREIGN KEY ("sourceMerchantId") REFERENCES "Merchant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DO $$
DECLARE
  bad integer;
  stamped integer;
  fixture_note text := 'Phase 1 validation fixture. Not a live customer request. Merchandise price is not set. totalCents is not payable.';
  fixture_email text := 'phase1-unresolved-validation@duts.invalid';
BEGIN
  SELECT COUNT(*) INTO bad
  FROM "CommerceCheckout" c
  LEFT JOIN "User" u ON u.id = c."customerId"
  WHERE c."checkoutNumber" IN (1, 2)
    AND NOT (
      c.notes = fixture_note
      AND u.email = fixture_email
      AND c.status = 'AWAITING_FULFILLMENT'
    );

  IF bad > 0 THEN
    RAISE EXCEPTION 'fixture backfill predicate failed';
  END IF;

  UPDATE "CommerceCheckout" c
  SET "validationFixture" = true
  FROM "User" u
  WHERE c."customerId" = u.id
    AND c."checkoutNumber" IN (1, 2)
    AND c.notes = fixture_note
    AND u.email = fixture_email
    AND c.status = 'AWAITING_FULFILLMENT';

  GET DIAGNOSTICS stamped = ROW_COUNT;
  IF stamped NOT IN (0, 2) THEN
    RAISE EXCEPTION 'fixture backfill count %', stamped;
  END IF;
END $$;
