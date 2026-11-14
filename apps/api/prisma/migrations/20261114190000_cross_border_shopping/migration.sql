-- Additive cross-border shopping tables. Does not alter local commerce tables.

CREATE TYPE "CrossBorderRequestStatus" AS ENUM (
  'REQUESTED',
  'UNDER_REVIEW',
  'QUOTED',
  'AWAITING_PAYMENT',
  'PAYMENT_PENDING',
  'PAID',
  'READY_TO_PURCHASE',
  'PURCHASED',
  'RECEIVED_IN_SOUTH_AFRICA',
  'IN_TRANSIT_TO_ZIMBABWE',
  'CUSTOMS_CLEARANCE',
  'READY_FOR_LOCAL_DELIVERY',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'CANCELLED',
  'PRODUCT_UNAVAILABLE',
  'PAYMENT_FAILED',
  'REFUND_PENDING',
  'REFUNDED'
);

CREATE TYPE "CrossBorderQuoteStatus" AS ENUM (
  'DRAFT',
  'APPROVED',
  'SENT',
  'EXPIRED',
  'SUPERSEDED',
  'ACCEPTED'
);

CREATE TYPE "CrossBorderContactChannel" AS ENUM ('WHATSAPP', 'EMAIL');

CREATE TYPE "CrossBorderPaymentStatus" AS ENUM (
  'CREATED',
  'PENDING',
  'PAID',
  'FAILED',
  'CANCELLED',
  'EXPIRED',
  'EXCEPTION'
);

CREATE TYPE "CrossBorderNotificationStatus" AS ENUM (
  'CREATED',
  'ATTEMPTED',
  'ACCEPTED',
  'FAILED'
);

CREATE TABLE "CrossBorderReferenceCounter" (
  "id" INTEGER NOT NULL,
  "nextValue" INTEGER NOT NULL,
  CONSTRAINT "CrossBorderReferenceCounter_pkey" PRIMARY KEY ("id")
);

INSERT INTO "CrossBorderReferenceCounter" ("id", "nextValue") VALUES (1, 1001);

CREATE TABLE "CrossBorderRequest" (
  "id" TEXT NOT NULL,
  "reference" TEXT NOT NULL,
  "customerId" TEXT,
  "customerName" TEXT NOT NULL,
  "phone" TEXT,
  "email" TEXT,
  "preferredContactChannel" "CrossBorderContactChannel" NOT NULL,
  "destinationCountry" TEXT NOT NULL DEFAULT 'ZW',
  "destinationCity" TEXT NOT NULL,
  "deliveryAddress" TEXT NOT NULL,
  "deliveryInstructions" TEXT,
  "status" "CrossBorderRequestStatus" NOT NULL DEFAULT 'REQUESTED',
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "trackingTokenHash" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "whatsappIdempotencyKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CrossBorderRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CrossBorderRequest_reference_key" ON "CrossBorderRequest"("reference");
CREATE UNIQUE INDEX "CrossBorderRequest_trackingTokenHash_key" ON "CrossBorderRequest"("trackingTokenHash");
CREATE UNIQUE INDEX "CrossBorderRequest_whatsappIdempotencyKey_key" ON "CrossBorderRequest"("whatsappIdempotencyKey");
CREATE INDEX "CrossBorderRequest_status_createdAt_idx" ON "CrossBorderRequest"("status", "createdAt");

CREATE TABLE "CrossBorderRequestLine" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "retailer" TEXT NOT NULL,
  "productUrl" TEXT NOT NULL,
  "productName" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "size" TEXT,
  "color" TEXT,
  "variantDetails" TEXT,
  "notes" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "CrossBorderRequestLine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CrossBorderRequestLine_requestId_idx" ON "CrossBorderRequestLine"("requestId");
ALTER TABLE "CrossBorderRequestLine"
  ADD CONSTRAINT "CrossBorderRequestLine_requestId_fkey"
  FOREIGN KEY ("requestId") REFERENCES "CrossBorderRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CrossBorderQuote" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "currency" TEXT NOT NULL,
  "merchandiseSubtotalCents" INTEGER NOT NULL,
  "saShippingCents" INTEGER NOT NULL,
  "crossBorderFreightCents" INTEGER NOT NULL,
  "customsCents" INTEGER NOT NULL,
  "customsIsEstimate" BOOLEAN NOT NULL DEFAULT true,
  "serviceFeeCents" INTEGER NOT NULL,
  "zimbabweDeliveryCents" INTEGER NOT NULL,
  "additionalCents" INTEGER NOT NULL DEFAULT 0,
  "additionalLabel" TEXT,
  "totalCents" INTEGER NOT NULL,
  "zarMerchandiseCents" INTEGER,
  "exchangeRate" TEXT,
  "exchangeRateSource" TEXT,
  "exchangeRateAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "status" "CrossBorderQuoteStatus" NOT NULL,
  "deliveryEstimateNote" TEXT,
  "termsVersion" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "approvedById" TEXT,
  "approvedAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "acceptedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CrossBorderQuote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CrossBorderQuote_requestId_version_key" ON "CrossBorderQuote"("requestId", "version");
CREATE INDEX "CrossBorderQuote_requestId_status_idx" ON "CrossBorderQuote"("requestId", "status");
ALTER TABLE "CrossBorderQuote"
  ADD CONSTRAINT "CrossBorderQuote_requestId_fkey"
  FOREIGN KEY ("requestId") REFERENCES "CrossBorderRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CrossBorderQuoteLine" (
  "id" TEXT NOT NULL,
  "quoteId" TEXT NOT NULL,
  "requestLineId" TEXT NOT NULL,
  "productName" TEXT NOT NULL,
  "retailer" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "size" TEXT,
  "color" TEXT,
  "variantDetails" TEXT,
  "unitPriceCents" INTEGER NOT NULL,
  "lineTotalCents" INTEGER NOT NULL,
  CONSTRAINT "CrossBorderQuoteLine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CrossBorderQuoteLine_quoteId_idx" ON "CrossBorderQuoteLine"("quoteId");
ALTER TABLE "CrossBorderQuoteLine"
  ADD CONSTRAINT "CrossBorderQuoteLine_quoteId_fkey"
  FOREIGN KEY ("quoteId") REFERENCES "CrossBorderQuote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CrossBorderPaymentToken" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "quoteId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CrossBorderPaymentToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CrossBorderPaymentToken_tokenHash_key" ON "CrossBorderPaymentToken"("tokenHash");
CREATE INDEX "CrossBorderPaymentToken_quoteId_idx" ON "CrossBorderPaymentToken"("quoteId");
ALTER TABLE "CrossBorderPaymentToken"
  ADD CONSTRAINT "CrossBorderPaymentToken_requestId_fkey"
  FOREIGN KEY ("requestId") REFERENCES "CrossBorderRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CrossBorderPaymentToken"
  ADD CONSTRAINT "CrossBorderPaymentToken_quoteId_fkey"
  FOREIGN KEY ("quoteId") REFERENCES "CrossBorderQuote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CrossBorderPayment" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "quoteId" TEXT NOT NULL,
  "quoteVersion" INTEGER NOT NULL,
  "provider" TEXT NOT NULL,
  "providerReference" TEXT,
  "merchantReference" TEXT NOT NULL,
  "paymentMethod" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "status" "CrossBorderPaymentStatus" NOT NULL DEFAULT 'CREATED',
  "idempotencyKey" TEXT NOT NULL,
  "payerPhone" TEXT,
  "paidAt" TIMESTAMP(3),
  "failureReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CrossBorderPayment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CrossBorderPayment_merchantReference_key" ON "CrossBorderPayment"("merchantReference");
CREATE UNIQUE INDEX "CrossBorderPayment_idempotencyKey_key" ON "CrossBorderPayment"("idempotencyKey");
CREATE UNIQUE INDEX "CrossBorderPayment_one_paid_per_request" ON "CrossBorderPayment"("requestId") WHERE "status" = 'PAID';
CREATE INDEX "CrossBorderPayment_requestId_status_idx" ON "CrossBorderPayment"("requestId", "status");
CREATE INDEX "CrossBorderPayment_quoteId_idx" ON "CrossBorderPayment"("quoteId");
ALTER TABLE "CrossBorderPayment"
  ADD CONSTRAINT "CrossBorderPayment_requestId_fkey"
  FOREIGN KEY ("requestId") REFERENCES "CrossBorderRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CrossBorderPayment"
  ADD CONSTRAINT "CrossBorderPayment_quoteId_fkey"
  FOREIGN KEY ("quoteId") REFERENCES "CrossBorderQuote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CrossBorderShipment" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "retailerOrderReference" TEXT,
  "purchaseAmountCents" INTEGER,
  "purchaseCurrency" TEXT,
  "purchaseDate" TIMESTAMP(3),
  "receiptReference" TEXT,
  "saReceivingNote" TEXT,
  "retailerTrackingNumber" TEXT,
  "shippingProvider" TEXT,
  "trackingNumber" TEXT,
  "shipmentStatus" TEXT,
  "customsNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CrossBorderShipment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CrossBorderShipment_requestId_key" ON "CrossBorderShipment"("requestId");
ALTER TABLE "CrossBorderShipment"
  ADD CONSTRAINT "CrossBorderShipment_requestId_fkey"
  FOREIGN KEY ("requestId") REFERENCES "CrossBorderRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CrossBorderNotification" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "quoteId" TEXT,
  "channel" "CrossBorderContactChannel" NOT NULL,
  "kind" TEXT NOT NULL,
  "status" "CrossBorderNotificationStatus" NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "providerMessageId" TEXT,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CrossBorderNotification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CrossBorderNotification_idempotencyKey_key" ON "CrossBorderNotification"("idempotencyKey");
CREATE INDEX "CrossBorderNotification_requestId_createdAt_idx" ON "CrossBorderNotification"("requestId", "createdAt");
ALTER TABLE "CrossBorderNotification"
  ADD CONSTRAINT "CrossBorderNotification_requestId_fkey"
  FOREIGN KEY ("requestId") REFERENCES "CrossBorderRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CrossBorderAuditEvent" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "actorId" TEXT,
  "action" TEXT NOT NULL,
  "payload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CrossBorderAuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CrossBorderAuditEvent_requestId_createdAt_idx" ON "CrossBorderAuditEvent"("requestId", "createdAt");
ALTER TABLE "CrossBorderAuditEvent"
  ADD CONSTRAINT "CrossBorderAuditEvent_requestId_fkey"
  FOREIGN KEY ("requestId") REFERENCES "CrossBorderRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
