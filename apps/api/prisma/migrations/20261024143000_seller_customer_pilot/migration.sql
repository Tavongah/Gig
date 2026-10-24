-- Controlled customer pilot. Additive.
-- Existing seller offers stay hidden from customers.

ALTER TABLE "SellerOffer" ADD COLUMN "customerPilotEnabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "SellerFulfillment" ADD COLUMN "customerUserId" TEXT;
CREATE INDEX "SellerFulfillment_customerUserId_idx" ON "SellerFulfillment"("customerUserId");

CREATE TABLE "SellerPaymentAttempt" (
    "id" TEXT NOT NULL,
    "sellerFulfillmentId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerPaymentId" TEXT,
    "merchantReference" TEXT,
    "payerPhone" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "status" "CommercePaymentAttemptStatus" NOT NULL DEFAULT 'CREATED',
    "failureReason" TEXT,
    "pollUrl" TEXT,
    "paynowReference" TEXT,
    "expiresAt" TIMESTAMP(3),
    "initiatedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SellerPaymentAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SellerPaymentAttempt_providerPaymentId_key" ON "SellerPaymentAttempt"("providerPaymentId");
CREATE UNIQUE INDEX "SellerPaymentAttempt_merchantReference_key" ON "SellerPaymentAttempt"("merchantReference");
CREATE INDEX "SellerPaymentAttempt_sellerFulfillmentId_status_idx" ON "SellerPaymentAttempt"("sellerFulfillmentId", "status");

ALTER TABLE "SellerPaymentAttempt" ADD CONSTRAINT "SellerPaymentAttempt_sellerFulfillmentId_fkey"
  FOREIGN KEY ("sellerFulfillmentId") REFERENCES "SellerFulfillment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
