-- Durable merchant WhatsApp notification outbox + courier assignment release audit.
-- Does not alter CommercePaymentAttempt, ZB fields, or CommerceOrder payment semantics.

CREATE TYPE "CommerceNotificationStatus" AS ENUM (
  'PENDING',
  'QUEUED',
  'SENT',
  'DELIVERED',
  'UNDELIVERED',
  'FAILED',
  'NEEDS_ATTENTION'
);

CREATE TABLE "CommerceNotificationAttempt" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "commerceOrderId" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'WHATSAPP',
    "messagePurpose" TEXT NOT NULL DEFAULT 'NEW_ORDER',
    "provider" TEXT NOT NULL,
    "providerMessageSid" TEXT,
    "toPhone" TEXT NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "status" "CommerceNotificationStatus" NOT NULL DEFAULT 'PENDING',
    "lastAttemptAt" TIMESTAMP(3),
    "nextRetryAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "lastErrorCategory" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommerceNotificationAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CommerceNotificationAttempt_idempotencyKey_key" ON "CommerceNotificationAttempt"("idempotencyKey");
CREATE INDEX "CommerceNotificationAttempt_status_nextRetryAt_idx" ON "CommerceNotificationAttempt"("status", "nextRetryAt");
CREATE INDEX "CommerceNotificationAttempt_commerceOrderId_messagePurpose_idx" ON "CommerceNotificationAttempt"("commerceOrderId", "messagePurpose");
CREATE INDEX "CommerceNotificationAttempt_providerMessageSid_idx" ON "CommerceNotificationAttempt"("providerMessageSid");

ALTER TABLE "CommerceNotificationAttempt" ADD CONSTRAINT "CommerceNotificationAttempt_commerceOrderId_fkey" FOREIGN KEY ("commerceOrderId") REFERENCES "CommerceOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CourierDeliveryRelease" (
    "id" TEXT NOT NULL,
    "courierId" TEXT NOT NULL,
    "gigId" TEXT NOT NULL,
    "commerceOrderId" TEXT,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "stage" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourierDeliveryRelease_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CourierDeliveryRelease_courierId_createdAt_idx" ON "CourierDeliveryRelease"("courierId", "createdAt");
CREATE INDEX "CourierDeliveryRelease_gigId_createdAt_idx" ON "CourierDeliveryRelease"("gigId", "createdAt");
CREATE INDEX "CourierDeliveryRelease_commerceOrderId_idx" ON "CourierDeliveryRelease"("commerceOrderId");
