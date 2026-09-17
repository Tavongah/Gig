-- Additive guest web → WhatsApp basket handoff (hashed token only).

CREATE TABLE "GuestCommerceHandoff" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "basketJson" JSONB NOT NULL,
    "deliveryLabel" TEXT NOT NULL,
    "deliveryLat" DECIMAL(9,6) NOT NULL,
    "deliveryLng" DECIMAL(9,6) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuestCommerceHandoff_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GuestCommerceHandoff_tokenHash_key" ON "GuestCommerceHandoff"("tokenHash");
CREATE INDEX "GuestCommerceHandoff_expiresAt_idx" ON "GuestCommerceHandoff"("expiresAt");
CREATE INDEX "GuestCommerceHandoff_merchantId_idx" ON "GuestCommerceHandoff"("merchantId");

ALTER TABLE "GuestCommerceHandoff" ADD CONSTRAINT "GuestCommerceHandoff_merchantId_fkey"
  FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
