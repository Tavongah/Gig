-- CommerceCustomer identity layer (WhatsApp / guest web / app).
-- Backfill-safe: existing CommerceOrder.customerId (User) remains; commerceCustomerId added nullable then backfilled.

DO $$ BEGIN
  CREATE TYPE "CommerceCustomerSource" AS ENUM ('WHATSAPP', 'WEB_GUEST', 'APP');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "CommerceCustomer" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "primaryPhone" TEXT,
  "whatsappPhone" TEXT,
  "displayName" TEXT,
  "source" "CommerceCustomerSource" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommerceCustomer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CommerceCustomer_whatsappPhone_key"
  ON "CommerceCustomer"("whatsappPhone");

CREATE INDEX IF NOT EXISTS "CommerceCustomer_primaryPhone_idx"
  ON "CommerceCustomer"("primaryPhone");

CREATE INDEX IF NOT EXISTS "CommerceCustomer_userId_idx"
  ON "CommerceCustomer"("userId");

CREATE INDEX IF NOT EXISTS "CommerceCustomer_source_idx"
  ON "CommerceCustomer"("source");

DO $$ BEGIN
  ALTER TABLE "CommerceCustomer"
    ADD CONSTRAINT "CommerceCustomer_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "CommerceOrder"
  ADD COLUMN IF NOT EXISTS "commerceCustomerId" TEXT;

CREATE INDEX IF NOT EXISTS "CommerceOrder_commerceCustomerId_status_idx"
  ON "CommerceOrder"("commerceCustomerId", "status");

-- Allow WhatsApp / guest orders without a User account.
ALTER TABLE "CommerceOrder" ALTER COLUMN "customerId" DROP NOT NULL;

ALTER TABLE "WhatsAppConversation"
  ADD COLUMN IF NOT EXISTS "commerceCustomerId" TEXT;

CREATE INDEX IF NOT EXISTS "WhatsAppConversation_commerceCustomerId_idx"
  ON "WhatsAppConversation"("commerceCustomerId");

-- Backfill one CommerceCustomer per User that has commerce orders.
INSERT INTO "CommerceCustomer" ("id", "userId", "primaryPhone", "whatsappPhone", "displayName", "source", "createdAt", "updatedAt")
SELECT
  'cc_' || replace(u."id", '-', ''),
  u."id",
  u."phoneNumber",
  NULL,
  u."fullName",
  CASE
    WHEN u."email" LIKE 'wa\_%@whatsapp.duts.local' ESCAPE '\' THEN 'WHATSAPP'::"CommerceCustomerSource"
    ELSE 'APP'::"CommerceCustomerSource"
  END,
  NOW(),
  NOW()
FROM "User" u
WHERE EXISTS (SELECT 1 FROM "CommerceOrder" o WHERE o."customerId" = u."id")
  AND NOT EXISTS (SELECT 1 FROM "CommerceCustomer" cc WHERE cc."userId" = u."id");

-- Attach unique WhatsApp phones where available (skip collisions).
UPDATE "CommerceCustomer" cc
SET
  "whatsappPhone" = sub.phone,
  "primaryPhone" = COALESCE(cc."primaryPhone", sub.phone)
FROM (
  SELECT DISTINCT ON (o."customerId")
    o."customerId" AS user_id,
    COALESCE(o."customerWhatsAppPhone", u."phoneNumber") AS phone
  FROM "CommerceOrder" o
  JOIN "User" u ON u."id" = o."customerId"
  WHERE o."customerWhatsAppPhone" IS NOT NULL OR u."phoneNumber" IS NOT NULL
  ORDER BY o."customerId", o."createdAt" ASC
) sub
WHERE cc."userId" = sub.user_id
  AND cc."whatsappPhone" IS NULL
  AND sub.phone IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "CommerceCustomer" other
    WHERE other."whatsappPhone" = sub.phone AND other."id" <> cc."id"
  );

UPDATE "CommerceOrder" o
SET "commerceCustomerId" = cc."id"
FROM "CommerceCustomer" cc
WHERE o."customerId" IS NOT NULL
  AND cc."userId" = o."customerId"
  AND o."commerceCustomerId" IS NULL;

UPDATE "WhatsAppConversation" w
SET "commerceCustomerId" = cc."id"
FROM "CommerceCustomer" cc
WHERE w."customerUserId" IS NOT NULL
  AND cc."userId" = w."customerUserId"
  AND w."commerceCustomerId" IS NULL;

DO $$ BEGIN
  ALTER TABLE "CommerceOrder"
    ADD CONSTRAINT "CommerceOrder_commerceCustomerId_fkey"
    FOREIGN KEY ("commerceCustomerId") REFERENCES "CommerceCustomer"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "WhatsAppConversation"
    ADD CONSTRAINT "WhatsAppConversation_commerceCustomerId_fkey"
    FOREIGN KEY ("commerceCustomerId") REFERENCES "CommerceCustomer"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
