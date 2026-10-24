-- Seller Marketplace V1 foundation.
-- Additive only. Does not alter Merchant, Product, CatalogProduct rows,
-- CommerceOrder, payments, or delivery records.
-- New seller commission column does not change marketplaceMerchantCommissionRate.

ALTER TABLE "PlatformSetting"
  ADD COLUMN IF NOT EXISTS "marketplaceSellerCommissionRate" DECIMAL(4,3) NOT NULL DEFAULT 0.15;

CREATE TYPE "SellerStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED');

CREATE TYPE "SellerOfferStatus" AS ENUM ('ACTIVE', 'PAUSED', 'SOLD_OUT');

CREATE TYPE "SellerLedgerKind" AS ENUM ('SALE', 'ADJUSTMENT');

CREATE TYPE "SellerSettlementStatus" AS ENUM ('AWAITING_COLLECTION', 'ACCRUED', 'REVERSED');

CREATE TABLE "Seller" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "displayName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "whatsappPhone" TEXT,
    "pickupLocationLabel" TEXT NOT NULL,
    "pickupLatitude" DECIMAL(9,6) NOT NULL,
    "pickupLongitude" DECIMAL(9,6) NOT NULL,
    "pickupContactName" TEXT NOT NULL,
    "status" "SellerStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Seller_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Seller_whatsappPhone_key" ON "Seller"("whatsappPhone");
CREATE INDEX "Seller_status_idx" ON "Seller"("status");
CREATE INDEX "Seller_ownerUserId_idx" ON "Seller"("ownerUserId");

ALTER TABLE "Seller" ADD CONSTRAINT "Seller_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "SellerOffer" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "catalogProductId" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "status" "SellerOfferStatus" NOT NULL DEFAULT 'PAUSED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SellerOffer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SellerOffer_sellerId_catalogProductId_key" ON "SellerOffer"("sellerId", "catalogProductId");
CREATE INDEX "SellerOffer_catalogProductId_idx" ON "SellerOffer"("catalogProductId");
CREATE INDEX "SellerOffer_status_idx" ON "SellerOffer"("status");

ALTER TABLE "SellerOffer" ADD CONSTRAINT "SellerOffer_sellerId_fkey"
  FOREIGN KEY ("sellerId") REFERENCES "Seller"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SellerOffer" ADD CONSTRAINT "SellerOffer_catalogProductId_fkey"
  FOREIGN KEY ("catalogProductId") REFERENCES "CatalogProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "SellerLedgerEntry" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "sellerOfferId" TEXT NOT NULL,
    "catalogProductId" TEXT NOT NULL,
    "productNameSnapshot" TEXT NOT NULL,
    "kind" "SellerLedgerKind" NOT NULL DEFAULT 'SALE',
    "quantity" INTEGER NOT NULL,
    "unitPriceCents" INTEGER NOT NULL,
    "merchandiseCents" INTEGER NOT NULL,
    "commissionRate" DECIMAL(4,3) NOT NULL,
    "commissionCents" INTEGER NOT NULL,
    "sellerProceedsCents" INTEGER NOT NULL,
    "deliveryFeeCents" INTEGER NOT NULL DEFAULT 0,
    "paymentStatus" "CommercePaymentStatus" NOT NULL,
    "settlementStatus" "SellerSettlementStatus" NOT NULL,
    "reversesEntryId" TEXT,
    "reference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SellerLedgerEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SellerLedgerEntry_sellerId_createdAt_idx" ON "SellerLedgerEntry"("sellerId", "createdAt");
CREATE INDEX "SellerLedgerEntry_sellerOfferId_idx" ON "SellerLedgerEntry"("sellerOfferId");
CREATE INDEX "SellerLedgerEntry_settlementStatus_idx" ON "SellerLedgerEntry"("settlementStatus");

ALTER TABLE "SellerLedgerEntry" ADD CONSTRAINT "SellerLedgerEntry_sellerId_fkey"
  FOREIGN KEY ("sellerId") REFERENCES "Seller"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SellerLedgerEntry" ADD CONSTRAINT "SellerLedgerEntry_sellerOfferId_fkey"
  FOREIGN KEY ("sellerOfferId") REFERENCES "SellerOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SellerLedgerEntry" ADD CONSTRAINT "SellerLedgerEntry_reversesEntryId_fkey"
  FOREIGN KEY ("reversesEntryId") REFERENCES "SellerLedgerEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
