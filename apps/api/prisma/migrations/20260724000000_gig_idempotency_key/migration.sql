-- AlterTable
ALTER TABLE "Gig" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Gig_idempotencyKey_key" ON "Gig"("idempotencyKey");
