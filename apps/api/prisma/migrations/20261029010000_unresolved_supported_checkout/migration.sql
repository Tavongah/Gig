-- Additive unresolved supported-city demand.
-- Existing CommerceCheckout rows keep their status. packageClass stays NULL.
-- No backfill. No change to CommerceOrder.merchantId.

ALTER TYPE "CommerceCheckoutStatus" ADD VALUE IF NOT EXISTS 'AWAITING_FULFILLMENT';

CREATE TYPE "CommerceCheckoutLineFulfillment" AS ENUM ('AWAITING_SOURCE');

ALTER TABLE "CommerceCheckout" ADD COLUMN "packageClass" TEXT;

CREATE TABLE "CommerceCheckoutLine" (
    "id" TEXT NOT NULL,
    "checkoutId" TEXT NOT NULL,
    "catalogProductId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "productNameSnapshot" TEXT NOT NULL,
    "fulfillmentStatus" "CommerceCheckoutLineFulfillment" NOT NULL DEFAULT 'AWAITING_SOURCE',
    "unitPriceCents" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CommerceCheckoutLine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CommerceCheckoutLine_checkoutId_idx" ON "CommerceCheckoutLine"("checkoutId");
CREATE INDEX "CommerceCheckoutLine_catalogProductId_idx" ON "CommerceCheckoutLine"("catalogProductId");

ALTER TABLE "CommerceCheckoutLine"
  ADD CONSTRAINT "CommerceCheckoutLine_checkoutId_fkey"
  FOREIGN KEY ("checkoutId") REFERENCES "CommerceCheckout"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CommerceCheckoutLine"
  ADD CONSTRAINT "CommerceCheckoutLine_catalogProductId_fkey"
  FOREIGN KEY ("catalogProductId") REFERENCES "CatalogProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
