-- Seller Marketplace V1 (Point 1: seller-owned inventory). Additive only.

-- AlterTable
ALTER TABLE "PlatformSetting" ADD COLUMN "marketplaceSellerCommissionRate" DECIMAL(4,3) NOT NULL DEFAULT 0.15;

-- CreateEnum
CREATE TYPE "SellerStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "SellerOfferStatus" AS ENUM ('ACTIVE', 'PAUSED', 'SOLD_OUT');

-- CreateEnum
CREATE TYPE "SellerSettlementStatus" AS ENUM ('PENDING_PAYMENT', 'READY_FOR_SETTLEMENT', 'SETTLED', 'VOIDED');

-- CreateTable
CREATE TABLE "Seller" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "displayName" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "whatsappPhone" TEXT,
    "pickupLocationLabel" TEXT NOT NULL,
    "pickupLatitude" DECIMAL(9,6) NOT NULL,
    "pickupLongitude" DECIMAL(9,6) NOT NULL,
    "status" "SellerStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Seller_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SellerOffer" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "catalogProductId" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "quantityAvailable" INTEGER NOT NULL DEFAULT 0,
    "status" "SellerOfferStatus" NOT NULL DEFAULT 'ACTIVE',
    "conditionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SellerOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SellerSettlement" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "sellerOfferId" TEXT NOT NULL,
    "catalogProductId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "merchandiseCents" INTEGER NOT NULL,
    "commissionRateSnapshot" DECIMAL(4,3) NOT NULL,
    "commissionCents" INTEGER NOT NULL,
    "sellerProceedsCents" INTEGER NOT NULL,
    "deliveryFeeCents" INTEGER NOT NULL DEFAULT 0,
    "commerceOrderId" TEXT,
    "status" "SellerSettlementStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "paymentStatusSnapshot" TEXT,
    "fulfilledAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SellerSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Seller_status_idx" ON "Seller"("status");

-- CreateIndex
CREATE INDEX "Seller_ownerUserId_idx" ON "Seller"("ownerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Seller_whatsappPhone_key" ON "Seller"("whatsappPhone");

-- CreateIndex
CREATE INDEX "SellerOffer_catalogProductId_status_idx" ON "SellerOffer"("catalogProductId", "status");

-- CreateIndex
CREATE INDEX "SellerOffer_sellerId_status_idx" ON "SellerOffer"("sellerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SellerOffer_sellerId_catalogProductId_key" ON "SellerOffer"("sellerId", "catalogProductId");

-- CreateIndex
CREATE INDEX "SellerSettlement_sellerId_status_idx" ON "SellerSettlement"("sellerId", "status");

-- CreateIndex
CREATE INDEX "SellerSettlement_sellerOfferId_idx" ON "SellerSettlement"("sellerOfferId");

-- CreateIndex
CREATE INDEX "SellerSettlement_commerceOrderId_idx" ON "SellerSettlement"("commerceOrderId");

-- AddForeignKey
ALTER TABLE "Seller" ADD CONSTRAINT "Seller_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellerOffer" ADD CONSTRAINT "SellerOffer_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "Seller"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellerOffer" ADD CONSTRAINT "SellerOffer_catalogProductId_fkey" FOREIGN KEY ("catalogProductId") REFERENCES "CatalogProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellerSettlement" ADD CONSTRAINT "SellerSettlement_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "Seller"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellerSettlement" ADD CONSTRAINT "SellerSettlement_sellerOfferId_fkey" FOREIGN KEY ("sellerOfferId") REFERENCES "SellerOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
