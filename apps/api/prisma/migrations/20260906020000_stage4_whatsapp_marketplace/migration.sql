-- Stage 4: WhatsApp shopping marketplace (customer + merchant WhatsApp)
-- CreateEnum
CREATE TYPE "MerchantCategory" AS ENUM ('TUCK_SHOP', 'GROCERY', 'BAKERY', 'FOOD', 'HOUSEHOLD', 'OTHER');

CREATE TYPE "CommerceOrderStatus" AS ENUM (
  'DRAFT', 'CUSTOMER_CONFIRMED', 'MERCHANT_PENDING', 'MERCHANT_ACCEPTED',
  'READY_FOR_PICKUP', 'COURIER_ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY',
  'DELIVERED', 'MERCHANT_REJECTED', 'CANCELLED', 'PAYMENT_FAILED'
);

CREATE TYPE "CommercePaymentStatus" AS ENUM (
  'PENDING', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'REFUNDED', 'NOT_REQUIRED'
);

CREATE TYPE "WhatsAppParty" AS ENUM ('CUSTOMER', 'MERCHANT');

CREATE TYPE "WhatsAppConversationState" AS ENUM (
  'IDLE', 'AWAITING_LOCATION', 'BUILDING_CART', 'AWAITING_PRODUCT_CHOICE',
  'AWAITING_ORDER_CONFIRMATION', 'AWAITING_PAYMENT', 'ORDER_ACTIVE',
  'MERCHANT_ONBOARDING', 'MERCHANT_MENU'
);

-- AlterTable PlatformSetting
ALTER TABLE "PlatformSetting" ADD COLUMN IF NOT EXISTS "marketplaceMerchantRadiusKm" DECIMAL(6,2) NOT NULL DEFAULT 5;
ALTER TABLE "PlatformSetting" ADD COLUMN IF NOT EXISTS "marketplaceServiceFeeCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PlatformSetting" ADD COLUMN IF NOT EXISTS "marketplaceMerchantCommissionRate" DECIMAL(4,3) NOT NULL DEFAULT 0.10;

-- CreateTable
CREATE TABLE "Merchant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "contactName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "whatsappPhone" TEXT NOT NULL,
    "locationLabel" TEXT NOT NULL,
    "latitude" DECIMAL(9,6) NOT NULL,
    "longitude" DECIMAL(9,6) NOT NULL,
    "category" "MerchantCategory" NOT NULL DEFAULT 'TUCK_SHOP',
    "logoUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "acceptsOrders" BOOLEAN NOT NULL DEFAULT true,
    "openingHours" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Merchant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "priceCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "available" BOOLEAN NOT NULL DEFAULT true,
    "quantityApprox" INTEGER,
    "unit" TEXT,
    "imageUrl" TEXT,
    "searchAliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommerceOrder" (
    "id" TEXT NOT NULL,
    "orderNumber" SERIAL NOT NULL,
    "customerId" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "status" "CommerceOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "paymentStatus" "CommercePaymentStatus" NOT NULL DEFAULT 'PENDING',
    "orderSource" "OrderSource" NOT NULL DEFAULT 'WHATSAPP',
    "subtotalCents" INTEGER NOT NULL,
    "deliveryFeeCents" INTEGER NOT NULL,
    "serviceFeeCents" INTEGER NOT NULL DEFAULT 0,
    "totalCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "deliveryLabel" TEXT NOT NULL,
    "deliveryLatitude" DECIMAL(9,6) NOT NULL,
    "deliveryLongitude" DECIMAL(9,6) NOT NULL,
    "linkedDeliveryGigId" TEXT,
    "customerWhatsAppPhone" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "merchantAcceptedAt" TIMESTAMP(3),
    "readyAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    CONSTRAINT "CommerceOrder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommerceOrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT,
    "productNameSnapshot" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPriceCents" INTEGER NOT NULL,
    "lineTotalCents" INTEGER NOT NULL,
    "unavailableMarked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CommerceOrderItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WhatsAppConversation" (
    "id" TEXT NOT NULL,
    "phoneNormalized" TEXT NOT NULL,
    "party" "WhatsAppParty" NOT NULL,
    "state" "WhatsAppConversationState" NOT NULL DEFAULT 'IDLE',
    "merchantId" TEXT,
    "customerUserId" TEXT,
    "contextJson" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WhatsAppConversation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WhatsAppInboundMessage" (
    "id" TEXT NOT NULL,
    "providerMessageId" TEXT NOT NULL,
    "phoneNormalized" TEXT NOT NULL,
    "party" "WhatsAppParty",
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "summary" TEXT,
    CONSTRAINT "WhatsAppInboundMessage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Merchant_whatsappPhone_key" ON "Merchant"("whatsappPhone");
CREATE INDEX "Merchant_isActive_acceptsOrders_idx" ON "Merchant"("isActive", "acceptsOrders");
CREATE INDEX "Merchant_latitude_longitude_idx" ON "Merchant"("latitude", "longitude");

CREATE INDEX "Product_merchantId_archived_available_idx" ON "Product"("merchantId", "archived", "available");
CREATE INDEX "Product_normalizedName_idx" ON "Product"("normalizedName");

CREATE UNIQUE INDEX "CommerceOrder_orderNumber_key" ON "CommerceOrder"("orderNumber");
CREATE UNIQUE INDEX "CommerceOrder_linkedDeliveryGigId_key" ON "CommerceOrder"("linkedDeliveryGigId");
CREATE INDEX "CommerceOrder_merchantId_status_idx" ON "CommerceOrder"("merchantId", "status");
CREATE INDEX "CommerceOrder_customerId_status_idx" ON "CommerceOrder"("customerId", "status");
CREATE INDEX "CommerceOrder_status_idx" ON "CommerceOrder"("status");

CREATE UNIQUE INDEX "WhatsAppConversation_phoneNormalized_party_key" ON "WhatsAppConversation"("phoneNormalized", "party");
CREATE INDEX "WhatsAppConversation_merchantId_idx" ON "WhatsAppConversation"("merchantId");

CREATE UNIQUE INDEX "WhatsAppInboundMessage_providerMessageId_key" ON "WhatsAppInboundMessage"("providerMessageId");

ALTER TABLE "Merchant" ADD CONSTRAINT "Merchant_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Product" ADD CONSTRAINT "Product_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommerceOrder" ADD CONSTRAINT "CommerceOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommerceOrder" ADD CONSTRAINT "CommerceOrder_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommerceOrder" ADD CONSTRAINT "CommerceOrder_linkedDeliveryGigId_fkey" FOREIGN KEY ("linkedDeliveryGigId") REFERENCES "Gig"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CommerceOrderItem" ADD CONSTRAINT "CommerceOrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "CommerceOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommerceOrderItem" ADD CONSTRAINT "CommerceOrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
