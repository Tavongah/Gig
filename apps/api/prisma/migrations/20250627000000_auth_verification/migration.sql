-- Auth verification and social login fields
CREATE TYPE "AuthProvider" AS ENUM ('EMAIL', 'GOOGLE', 'APPLE');

ALTER TABLE "User" ADD COLUMN "authProvider" "AuthProvider" NOT NULL DEFAULT 'EMAIL';
ALTER TABLE "User" ADD COLUMN "emailVerified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "phoneVerified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "profileCompleted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "formattedAddress" TEXT;
ALTER TABLE "User" ADD COLUMN "addressLine1" TEXT;
ALTER TABLE "User" ADD COLUMN "city" TEXT;
ALTER TABLE "User" ADD COLUMN "region" TEXT;
ALTER TABLE "User" ADD COLUMN "postalCode" TEXT;
ALTER TABLE "User" ADD COLUMN "country" TEXT DEFAULT 'US';
ALTER TABLE "User" ADD COLUMN "latitude" DECIMAL(9,6);
ALTER TABLE "User" ADD COLUMN "longitude" DECIMAL(9,6);

-- Keep one owner per phone number before enforcing uniqueness
WITH ranked AS (
    SELECT
        id,
        ROW_NUMBER() OVER (PARTITION BY "phoneNumber" ORDER BY "createdAt") AS rn
    FROM "User"
    WHERE "phoneNumber" IS NOT NULL
)
UPDATE "User" u
SET "phoneNumber" = NULL
FROM ranked r
WHERE u.id = r.id AND r.rn > 1;

CREATE UNIQUE INDEX "User_phoneNumber_key" ON "User"("phoneNumber");

CREATE TABLE "EmailVerificationToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmailVerificationToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailVerificationToken_tokenHash_key" ON "EmailVerificationToken"("tokenHash");
CREATE INDEX "EmailVerificationToken_userId_idx" ON "EmailVerificationToken"("userId");

ALTER TABLE "EmailVerificationToken" ADD CONSTRAINT "EmailVerificationToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing accounts keep full access
UPDATE "User"
SET
  "emailVerified" = true,
  "phoneVerified" = true,
  "profileCompleted" = true,
  "isVerified" = true
WHERE "emailVerified" = false;
