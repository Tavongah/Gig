-- DUTS 3-shop checkout V1 — additive parent checkout + pickup stops.
-- Does not rewrite historical CommerceOrder rows. checkoutId remains NULL for existing orders.

CREATE TYPE "CommerceCheckoutStatus" AS ENUM (
  'CONFIRMED',
  'PAYMENT_PENDING',
  'FULFILLING',
  'NEEDS_ATTENTION',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'CANCELLED',
  'PAYMENT_FAILED'
);

CREATE TABLE "CommerceCheckout" (
    "id" TEXT NOT NULL,
    "checkoutNumber" SERIAL NOT NULL,
    "customerId" TEXT,
    "commerceCustomerId" TEXT,
    "status" "CommerceCheckoutStatus" NOT NULL DEFAULT 'CONFIRMED',
    "paymentStatus" "CommercePaymentStatus" NOT NULL DEFAULT 'PENDING',
    "paymentMethod" "CommercePaymentMethod" NOT NULL DEFAULT 'CASH',
    "orderSource" "OrderSource" NOT NULL DEFAULT 'APP',
    "itemsSubtotalCents" INTEGER NOT NULL,
    "deliveryFeeCents" INTEGER NOT NULL,
    "serviceFeeCents" INTEGER NOT NULL DEFAULT 0,
    "totalCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "deliveryLabel" TEXT NOT NULL,
    "deliveryLatitude" DECIMAL(9,6) NOT NULL,
    "deliveryLongitude" DECIMAL(9,6) NOT NULL,
    "customerWhatsAppPhone" TEXT,
    "linkedDeliveryGigId" TEXT,
    "pickupSequence" JSONB NOT NULL,
    "currentPickupIndex" INTEGER NOT NULL DEFAULT 0,
    "allocations" JSONB NOT NULL,
    "notes" TEXT,
    "idempotencyKey" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommerceCheckout_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CommerceCheckout_checkoutNumber_key" ON "CommerceCheckout"("checkoutNumber");
CREATE UNIQUE INDEX "CommerceCheckout_linkedDeliveryGigId_key" ON "CommerceCheckout"("linkedDeliveryGigId");
CREATE UNIQUE INDEX "CommerceCheckout_idempotencyKey_key" ON "CommerceCheckout"("idempotencyKey");
CREATE INDEX "CommerceCheckout_customerId_status_idx" ON "CommerceCheckout"("customerId", "status");
CREATE INDEX "CommerceCheckout_commerceCustomerId_status_idx" ON "CommerceCheckout"("commerceCustomerId", "status");
CREATE INDEX "CommerceCheckout_status_idx" ON "CommerceCheckout"("status");

ALTER TABLE "CommerceCheckout" ADD CONSTRAINT "CommerceCheckout_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommerceCheckout" ADD CONSTRAINT "CommerceCheckout_commerceCustomerId_fkey" FOREIGN KEY ("commerceCustomerId") REFERENCES "CommerceCustomer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommerceCheckout" ADD CONSTRAINT "CommerceCheckout_linkedDeliveryGigId_fkey" FOREIGN KEY ("linkedDeliveryGigId") REFERENCES "Gig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CommerceOrder" ADD COLUMN "checkoutId" TEXT;
ALTER TABLE "CommerceOrder" ADD COLUMN "fulfillmentLabel" TEXT;
CREATE INDEX "CommerceOrder_checkoutId_idx" ON "CommerceOrder"("checkoutId");
ALTER TABLE "CommerceOrder" ADD CONSTRAINT "CommerceOrder_checkoutId_fkey" FOREIGN KEY ("checkoutId") REFERENCES "CommerceCheckout"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CommercePaymentAttempt" ADD COLUMN "commerceCheckoutId" TEXT;
CREATE INDEX "CommercePaymentAttempt_commerceCheckoutId_status_idx" ON "CommercePaymentAttempt"("commerceCheckoutId", "status");
ALTER TABLE "CommercePaymentAttempt" ADD CONSTRAINT "CommercePaymentAttempt_commerceCheckoutId_fkey" FOREIGN KEY ("commerceCheckoutId") REFERENCES "CommerceCheckout"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "CommerceCheckoutPickupStop" (
    "id" TEXT NOT NULL,
    "checkoutId" TEXT NOT NULL,
    "commerceOrderId" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "pickupPin" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "arrivedAt" TIMESTAMP(3),
    "collectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommerceCheckoutPickupStop_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CommerceCheckoutPickupStop_commerceOrderId_key" ON "CommerceCheckoutPickupStop"("commerceOrderId");
CREATE INDEX "CommerceCheckoutPickupStop_checkoutId_sequence_idx" ON "CommerceCheckoutPickupStop"("checkoutId", "sequence");
ALTER TABLE "CommerceCheckoutPickupStop" ADD CONSTRAINT "CommerceCheckoutPickupStop_checkoutId_fkey" FOREIGN KEY ("checkoutId") REFERENCES "CommerceCheckout"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommerceCheckoutPickupStop" ADD CONSTRAINT "CommerceCheckoutPickupStop_commerceOrderId_fkey" FOREIGN KEY ("commerceOrderId") REFERENCES "CommerceOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
