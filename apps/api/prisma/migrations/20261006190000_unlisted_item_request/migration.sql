-- Unlisted-item request V1. Does not alter catalog/commerce order tables.

CREATE TYPE "UnlistedItemRequestStatus" AS ENUM (
  'REQUESTED',
  'SEARCHING',
  'FOUND_AWAITING_CUSTOMER',
  'CUSTOMER_APPROVED',
  'CUSTOMER_DECLINED',
  'NOT_FOUND',
  'EXPIRED',
  'PAYMENT_PENDING',
  'PAID',
  'PURCHASED',
  'DELIVERING',
  'COMPLETED',
  'NEEDS_ATTENTION'
);

CREATE TYPE "UnlistedItemCustomerDecision" AS ENUM (
  'NONE',
  'APPROVED',
  'DECLINED'
);

CREATE TABLE "UnlistedItemRequest" (
  "id" TEXT NOT NULL,
  "requestNumber" SERIAL NOT NULL,
  "commerceCustomerId" TEXT,
  "customerUserId" TEXT,
  "checkoutSessionId" TEXT,
  "originalRequestText" TEXT NOT NULL,
  "parsedItemName" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "optionalNotes" TEXT,
  "optionalMaxBudgetCents" INTEGER,
  "status" "UnlistedItemRequestStatus" NOT NULL DEFAULT 'REQUESTED',
  "assignedCourierId" TEXT,
  "foundProductName" TEXT,
  "foundPriceCents" INTEGER,
  "foundPhotoUrl" TEXT,
  "foundMerchantName" TEXT,
  "foundNote" TEXT,
  "customerDecision" "UnlistedItemCustomerDecision" NOT NULL DEFAULT 'NONE',
  "approvalId" TEXT,
  "quoteVersion" INTEGER NOT NULL DEFAULT 0,
  "deliveryFeeCents" INTEGER,
  "totalCents" INTEGER,
  "deliveryLatitude" DECIMAL(9,6),
  "deliveryLongitude" DECIMAL(9,6),
  "deliveryLabel" TEXT,
  "deliveryPrecision" TEXT,
  "deliveryInstructions" TEXT,
  "whatsappPhone" TEXT,
  "orderSource" "OrderSource" NOT NULL DEFAULT 'WHATSAPP',
  "linkedDeliveryGigId" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "paidAt" TIMESTAMP(3),
  "purchasedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "UnlistedItemRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UnlistedItemRequest_requestNumber_key" ON "UnlistedItemRequest"("requestNumber");
CREATE UNIQUE INDEX "UnlistedItemRequest_linkedDeliveryGigId_key" ON "UnlistedItemRequest"("linkedDeliveryGigId");
CREATE INDEX "UnlistedItemRequest_status_expiresAt_idx" ON "UnlistedItemRequest"("status", "expiresAt");
CREATE INDEX "UnlistedItemRequest_assignedCourierId_status_idx" ON "UnlistedItemRequest"("assignedCourierId", "status");
CREATE INDEX "UnlistedItemRequest_commerceCustomerId_status_idx" ON "UnlistedItemRequest"("commerceCustomerId", "status");
CREATE INDEX "UnlistedItemRequest_whatsappPhone_status_idx" ON "UnlistedItemRequest"("whatsappPhone", "status");
CREATE INDEX "UnlistedItemRequest_status_createdAt_idx" ON "UnlistedItemRequest"("status", "createdAt");

CREATE TABLE "UnlistedItemRequestEvent" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "actorType" TEXT NOT NULL,
  "actorId" TEXT,
  "payload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "UnlistedItemRequestEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "UnlistedItemRequestEvent_requestId_createdAt_idx" ON "UnlistedItemRequestEvent"("requestId", "createdAt");

CREATE TABLE "UnlistedItemPaymentAttempt" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "providerPaymentId" TEXT,
  "merchantReference" TEXT,
  "paynowReference" TEXT,
  "pollUrl" TEXT,
  "payerPhone" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'usd',
  "status" "CommercePaymentAttemptStatus" NOT NULL DEFAULT 'CREATED',
  "failureReason" TEXT,
  "initiatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  "confirmedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "UnlistedItemPaymentAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UnlistedItemPaymentAttempt_merchantReference_key" ON "UnlistedItemPaymentAttempt"("merchantReference");
CREATE UNIQUE INDEX "UnlistedItemPaymentAttempt_provider_providerPaymentId_key" ON "UnlistedItemPaymentAttempt"("provider", "providerPaymentId");
CREATE INDEX "UnlistedItemPaymentAttempt_requestId_status_idx" ON "UnlistedItemPaymentAttempt"("requestId", "status");
CREATE INDEX "UnlistedItemPaymentAttempt_status_expiresAt_idx" ON "UnlistedItemPaymentAttempt"("status", "expiresAt");

ALTER TABLE "UnlistedItemRequest" ADD CONSTRAINT "UnlistedItemRequest_commerceCustomerId_fkey" FOREIGN KEY ("commerceCustomerId") REFERENCES "CommerceCustomer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "UnlistedItemRequest" ADD CONSTRAINT "UnlistedItemRequest_customerUserId_fkey" FOREIGN KEY ("customerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "UnlistedItemRequest" ADD CONSTRAINT "UnlistedItemRequest_assignedCourierId_fkey" FOREIGN KEY ("assignedCourierId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "UnlistedItemRequest" ADD CONSTRAINT "UnlistedItemRequest_linkedDeliveryGigId_fkey" FOREIGN KEY ("linkedDeliveryGigId") REFERENCES "Gig"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "UnlistedItemRequestEvent" ADD CONSTRAINT "UnlistedItemRequestEvent_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "UnlistedItemRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UnlistedItemPaymentAttempt" ADD CONSTRAINT "UnlistedItemPaymentAttempt_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "UnlistedItemRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
