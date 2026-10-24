-- Seller fulfillment pilot. Additive.
-- Does not change Merchant, Product, CommerceOrder, or merchant pickup stops.
-- reservedQuantity defaults to 0 so existing seller offers stay fully available.

ALTER TABLE "SellerOffer" ADD COLUMN "reservedQuantity" INTEGER NOT NULL DEFAULT 0;

CREATE TYPE "SellerFulfillmentStatus" AS ENUM (
  'PAYMENT_PENDING',
  'READY_FOR_PICKUP',
  'NEEDS_ATTENTION',
  'DELIVERED',
  'CANCELLED',
  'PAYMENT_FAILED'
);

CREATE TABLE "SellerFulfillment" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "sellerOfferId" TEXT NOT NULL,
    "catalogProductId" TEXT NOT NULL,
    "productNameSnapshot" TEXT NOT NULL,
    "sellerNameSnapshot" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPriceCents" INTEGER NOT NULL,
    "merchandiseCents" INTEGER NOT NULL,
    "commissionRate" DECIMAL(4,3) NOT NULL,
    "commissionCents" INTEGER NOT NULL,
    "sellerProceedsCents" INTEGER NOT NULL,
    "deliveryFeeCents" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "paymentStatus" "CommercePaymentStatus" NOT NULL DEFAULT 'PENDING',
    "paymentReference" TEXT,
    "status" "SellerFulfillmentStatus" NOT NULL DEFAULT 'PAYMENT_PENDING',
    "idempotencyKey" TEXT,
    "linkedDeliveryGigId" TEXT,
    "reservationReleasedAt" TIMESTAMP(3),
    "inventoryCommittedAt" TIMESTAMP(3),
    "dropoffLabel" TEXT NOT NULL,
    "dropoffLatitude" DECIMAL(9,6) NOT NULL,
    "dropoffLongitude" DECIMAL(9,6) NOT NULL,
    "dropoffContactName" TEXT NOT NULL,
    "dropoffContactPhone" TEXT NOT NULL,
    "needsAttentionReason" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SellerFulfillment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SellerFulfillment_idempotencyKey_key" ON "SellerFulfillment"("idempotencyKey");
CREATE UNIQUE INDEX "SellerFulfillment_linkedDeliveryGigId_key" ON "SellerFulfillment"("linkedDeliveryGigId");
CREATE INDEX "SellerFulfillment_sellerId_status_idx" ON "SellerFulfillment"("sellerId", "status");
CREATE INDEX "SellerFulfillment_sellerOfferId_idx" ON "SellerFulfillment"("sellerOfferId");
CREATE INDEX "SellerFulfillment_paymentStatus_idx" ON "SellerFulfillment"("paymentStatus");

ALTER TABLE "SellerFulfillment" ADD CONSTRAINT "SellerFulfillment_sellerId_fkey"
  FOREIGN KEY ("sellerId") REFERENCES "Seller"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SellerFulfillment" ADD CONSTRAINT "SellerFulfillment_sellerOfferId_fkey"
  FOREIGN KEY ("sellerOfferId") REFERENCES "SellerOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SellerFulfillment" ADD CONSTRAINT "SellerFulfillment_linkedDeliveryGigId_fkey"
  FOREIGN KEY ("linkedDeliveryGigId") REFERENCES "Gig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SellerLedgerEntry" ADD COLUMN "sellerFulfillmentId" TEXT;
CREATE UNIQUE INDEX "SellerLedgerEntry_sellerFulfillmentId_key" ON "SellerLedgerEntry"("sellerFulfillmentId");
ALTER TABLE "SellerLedgerEntry" ADD CONSTRAINT "SellerLedgerEntry_sellerFulfillmentId_fkey"
  FOREIGN KEY ("sellerFulfillmentId") REFERENCES "SellerFulfillment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
